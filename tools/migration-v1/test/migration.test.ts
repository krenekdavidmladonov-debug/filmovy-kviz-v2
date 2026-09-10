import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

import {
  assertSafeEmulatorEnvironment,
  calculateOutputStats,
  calculateSourceStats,
  classifyV1Slide,
  groupSlidesIntoRounds,
  isJsonObjectValue,
  MigrationSafetyError,
  MigrationValidationError,
  normalizeV1Library,
  normalizeV1Slide,
  transformQuiz,
  validateNormalizedInput,
  validateOutput,
  type JsonObject,
  type NormalizedQuiz,
  type V1LibrarySnapshot,
  type V2QuizDocument,
} from '../src/index.js';

const fixturePath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'library.json');

async function loadFixture() {
  const snapshot = JSON.parse(await readFile(fixturePath, 'utf8')) as V1LibrarySnapshot;
  const quizzes = normalizeV1Library(snapshot);
  validateNormalizedInput(quizzes);
  return { source: quizzes[0]!, output: transformQuiz(quizzes[0]!, new Date('2026-08-31T12:00:00Z')) };
}

function roundlessQuiz(): NormalizedQuiz {
  return {
    id: 'roundless',
    title: 'Roundless',
    description: '',
    slides: [
      normalizeV1Slide({ type: 'free', text: 'Q1', correct: 'A1', roundHeader: '' }, 0),
      normalizeV1Slide({ type: 'question', text: 'Q2', correct: 'A2', roundHeader: '' }, 1),
    ],
    legacyMetadata: {},
    unknownFields: [],
  };
}

describe('V1 migration framework', () => {
  test('recognizes every observed V1 slide type without treating repeated roundHeader strings as boundaries', () => {
    for (const type of ['question', 'free', 'image', 'audio', 'video', 'pl']) {
      expect(classifyV1Slide({ type, roundHeader: 'Kolo' })).toBe('question');
    }
    for (const type of ['intro', 'agenda', 'recap', 'end']) {
      expect(classifyV1Slide({ type, roundHeader: 'Kolo' })).toBe('content');
    }
    expect(classifyV1Slide({ type: 'roundHeader', roundHeader: true })).toBe('round');
    expect(classifyV1Slide({ type: 'unexplained-widget' })).toBe('legacy');
  });

  test('unwraps the real nested library document shape and preserves settings metadata', async () => {
    const { source } = await loadFixture();
    expect(source).toMatchObject({ id: 'synthetic-real-shapes', title: 'Syntetický kvíz' });
    expect(source.slides).toHaveLength(12);
    const nested = source.legacyMetadata.data;
    expect(isJsonObjectValue(nested) && isJsonObjectValue(nested.settings)).toBe(true);
  });

  test('derives round boundaries from roundHeader transitions and excludes the outro segment', async () => {
    const { source, output } = await loadFixture();
    const groups = groupSlidesIntoRounds(source.slides);
    expect(groups).toHaveLength(2);
    expect(groups.map((group) => group.slides.length)).toEqual([9, 2]);
    expect(output.rounds.map((round) => round.data.position)).toEqual([1, 2]);
    expect(output.slides[11]!.roundId).toBeUndefined();
  });

  test('starts a new round when a string header changes after an explicit round marker', () => {
    const slides = [
      normalizeV1Slide({ type: 'round', title: 'Explicit', roundHeader: true }, 0),
      normalizeV1Slide({ type: 'question', text: 'Q1', correct: 'A1', roundHeader: 'Explicit' }, 1),
      normalizeV1Slide({ type: 'question', text: 'Q2', correct: 'A2', roundHeader: 'Transition' }, 2),
    ];
    expect(groupSlidesIntoRounds(slides).map((group) => group.questions.length)).toEqual([1, 1]);
  });

  test('creates a lossless slide stream and questions only for question-like slides', async () => {
    const { source, output } = await loadFixture();
    expect(output.slides).toHaveLength(12);
    expect(output.rounds.flatMap((round) => round.questions)).toHaveLength(7);
    expect(calculateSourceStats([source])).toEqual(calculateOutputStats([output]));
    expect(calculateOutputStats([output]).correctAnswers).toBe(7);
  });

  test('maps observed question types, including video and the unexplained pl fallback', async () => {
    const { output } = await loadFixture();
    expect(output.rounds.flatMap((round) => round.questions).map((question) => question.data.type))
      .toEqual(['text', 'text', 'image', 'audio', 'video', 'legacy', 'text']);
  });

  test('preserves global slide order and per-round question order', async () => {
    const { output } = await loadFixture();
    expect(output.slides.map((slide) => slide.data.position)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(output.rounds[0]!.questions.map((question) => question.data.sourceSlidePosition)).toEqual([3, 4, 5, 6, 7, 8]);
    expect(output.rounds[1]!.questions.map((question) => question.data.position)).toEqual([1]);
  });

  test('preserves options, source question numbering, and private correct answers', async () => {
    const { output } = await loadFixture();
    const questions = output.rounds.flatMap((round) => round.questions);
    expect(questions[0]!.data.options).toHaveLength(4);
    expect(questions.at(-1)!.data.options).toHaveLength(5);
    expect(questions[0]!.data.sourceQuestionNumber).toBe('1/7');
    expect(questions.every((question) => question.data.correctAnswer !== undefined)).toBe(true);
  });

  test('resolves correctAnswer variants without allowing an ambiguous conflict', () => {
    expect(normalizeV1Slide({ type: 'question', correctAnswer: 'only-new' }, 0).correctAnswer)
      .toBe('only-new');
    expect(normalizeV1Slide({ type: 'question', correctAnswer: '', correct: 'non-empty' }, 0).correctAnswer)
      .toBe('non-empty');
    expect(() => normalizeV1Slide({
      type: 'question',
      correctAnswer: 'first',
      correct: 'different',
    }, 0)).toThrow(/conflicting non-empty correct and correctAnswer/u);
  });

  test('preserves and classifies mixed media without duplicating matching media/src values', async () => {
    const { source, output } = await loadFixture();
    const media = source.slides.flatMap((slide) => slide.media);
    expect(media.filter((item) => item.kind === 'image')).toHaveLength(4);
    expect(media.filter((item) => item.kind === 'audio')).toHaveLength(1);
    expect(media.filter((item) => item.kind === 'video')).toHaveLength(1);
    expect(source.slides[4]!.media).toHaveLength(1);
    expect(output.slides[5]!.data.media).toEqual([
      expect.objectContaining({ kind: 'audio', value: 'synthetic-audio-id' }),
    ]);
  });

  test('normalizes numeric-string timing, triggers, and overlay values while preserving raw forms', async () => {
    const { source, output } = await loadFixture();
    expect(source.slides[2]).toMatchObject({ backgroundOverlay: 75, answerOverlay: 30 });
    expect(source.slides[5]!.audioTrigger).toBe(35);
    expect(source.slides[6]).toMatchObject({ videoStart: 12, videoEnd: 20 });
    const legacy = output.slides[6]!.data.legacy;
    expect(isJsonObjectValue(legacy) && isJsonObjectValue(legacy.raw) && legacy.raw.videoStart).toBe('12');
  });

  test('detects the unexplained pl type and keeps its full private legacy record', async () => {
    const { source, output } = await loadFixture();
    expect(source.slides[7]).toMatchObject({ sourceType: 'pl', isQuestion: true });
    const legacy = output.slides[7]!.data.legacy;
    expect(isJsonObjectValue(legacy) && isJsonObjectValue(legacy.raw) && legacy.raw.id).toBe(42);
  });

  test('reports unknown fields without retaining their values in legacy.raw', async () => {
    const { source, output } = await loadFixture();
    expect(source.slides[2]!.unknownFields).toContain('syntheticUnknownField');
    const legacy = output.slides[2]!.data.legacy;
    expect(isJsonObjectValue(legacy) && isJsonObjectValue(legacy.raw) && legacy.raw.syntheticUnknownField).toBeUndefined();
  });

  test('rejects malformed slide values and invalid timing ranges', () => {
    expect(() => normalizeV1Library({
      schemaVersion: 1,
      collection: 'library',
      documents: [{ id: 'bad', data: { slides: ['not-an-object'] } }],
    })).toThrow(MigrationValidationError);
    const badQuiz: NormalizedQuiz = {
      ...roundlessQuiz(),
      slides: [normalizeV1Slide({ type: 'video', text: 'Q', correct: 'A', videoStart: 20, videoEnd: 10 }, 0)],
    };
    expect(() => validateNormalizedInput([badQuiz])).toThrow(/videoStart is after videoEnd/u);
  });

  test('detects lost raw V1 data', async () => {
    const { source, output } = await loadFixture();
    const slide = output.slides[2]!;
    const legacy = slide.data.legacy;
    if (!isJsonObjectValue(legacy) || !isJsonObjectValue(legacy.raw)) throw new Error('Bad test setup');
    const changedLegacy: JsonObject = { ...legacy, raw: { ...legacy.raw, text: 'changed' } };
    const changedSlides = [...output.slides];
    changedSlides[2] = { ...slide, data: { ...slide.data, legacy: changedLegacy } };
    const changedOutput: V2QuizDocument = { ...output, slides: changedSlides };
    expect(() => validateOutput([source], [changedOutput])).toThrow(/Lost or changed V1 slide data/u);
  });

  test('detects changed mapped prompt, options, media URL, and presentation data', async () => {
    const { source, output } = await loadFixture();
    const question = output.rounds[0]!.questions[0]!;
    const changedQuestion = {
      ...question,
      data: {
        ...question.data,
        prompt: 'changed prompt',
        options: ['changed'],
      },
    };
    const changedRound = {
      ...output.rounds[0]!,
      questions: [changedQuestion, ...output.rounds[0]!.questions.slice(1)],
    };
    expect(() => validateOutput([source], [{
      ...output,
      rounds: [changedRound, ...output.rounds.slice(1)],
    }])).toThrow(/Mapped question prompt changed/u);

    const mediaSlide = output.slides[2]!;
    const media = mediaSlide.data.media as JsonObject[];
    const changedMedia = [{ ...media[0]!, url: 'https://changed.example.test/same-kind.jpg' }, ...media.slice(1)];
    const changedSlides = [...output.slides];
    changedSlides[2] = {
      ...mediaSlide,
      data: {
        ...mediaSlide.data,
        media: changedMedia,
        presentation: { backgroundOverlay: 74, answerOverlay: 30, audioTrigger: 0, videoStart: 0, videoEnd: 0, sourceQuestionNumber: '1/7' },
      },
    };
    expect(() => validateOutput([source], [{ ...output, slides: changedSlides }]))
      .toThrow(/Mapped media changed/u);
  });

  test('detects a validation count mismatch instead of continuing best effort', async () => {
    const { source, output } = await loadFixture();
    const changedOutput: V2QuizDocument = { ...output, slides: output.slides.slice(0, -1) };
    expect(() => validateOutput([source], [changedOutput])).toThrow(/slide count changed/u);
  });

  test('creates one explicit implicit round for roundless question slides', () => {
    const source = roundlessQuiz();
    const output = transformQuiz(source);
    expect(output.rounds).toHaveLength(1);
    expect(output.rounds[0]!.data.legacy).toMatchObject({ generatedImplicitRound: true });
    expect(output.rounds[0]!.questions).toHaveLength(2);
    validateOutput([source], [output]);
  });

  test('rejects emulator writes without both a local host and demo project', () => {
    expect(() => assertSafeEmulatorEnvironment({})).toThrow(MigrationSafetyError);
    expect(() => assertSafeEmulatorEnvironment({
      FIRESTORE_EMULATOR_HOST: 'firestore.googleapis.com:443',
      GCLOUD_PROJECT: 'demo-safe',
    })).toThrow(MigrationSafetyError);
    expect(() => assertSafeEmulatorEnvironment({
      FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
      GCLOUD_PROJECT: 'production-project',
    })).toThrow(MigrationSafetyError);
    expect(assertSafeEmulatorEnvironment({
      FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
      GCLOUD_PROJECT: 'demo-filmovy-kviz-v2',
    })).toEqual({ baseUrl: 'http://127.0.0.1:8080', projectId: 'demo-filmovy-kviz-v2' });
    for (const host of [
      'evil@localhost:8080',
      'localhost:8080?x=1',
      'localhost:8080#x',
      'localhost\\:8080',
      'localhost:0',
      'localhost:65536',
    ]) {
      expect(() => assertSafeEmulatorEnvironment({
        FIRESTORE_EMULATOR_HOST: host,
        GCLOUD_PROJECT: 'demo-safe',
      })).toThrow(MigrationSafetyError);
    }
  });
});
