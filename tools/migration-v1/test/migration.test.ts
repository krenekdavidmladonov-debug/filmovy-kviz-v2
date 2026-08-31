import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

import {
  assertSafeEmulatorEnvironment,
  classifyV1Slide,
  isJsonObjectValue,
  MigrationSafetyError,
  MigrationValidationError,
  normalizeV1Library,
  normalizeV1Slide,
  transformQuiz,
  validateNormalizedInput,
  validateOutput,
  type JsonObject,
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

describe('V1 migration framework', () => {
  test('recognizes V1 round and question slides', () => {
    expect(classifyV1Slide({ roundHeader: true, title: 'Kolo' })).toBe('round');
    expect(classifyV1Slide({ type: 'text', text: 'Otázka', correct: 'Odpověď' })).toBe('question');
  });

  test('converts a question and keeps the private correct answer', () => {
    const slide = normalizeV1Slide({ type: 'text', text: 'Otázka', correct: 'Tajná odpověď' }, 0);
    const quiz = transformQuiz({ id: 'q', title: 'Q', description: '', slides: [slide], legacyMetadata: {}, unknownFields: [] });
    const question = quiz.rounds[0]!.questions[0]!;
    expect(question.data).toMatchObject({ prompt: 'Otázka', type: 'text', correctAnswer: 'Tajná odpověď' });
    expect(question.data.legacy).toBeDefined();
  });

  test('converts a round header into an ordered V2 round', async () => {
    const { output } = await loadFixture();
    expect(output.rounds[0]!.data).toMatchObject({ title: 'První kolo', position: 1, questionCount: 5 });
  });

  test('preserves slide and question order', async () => {
    const { output } = await loadFixture();
    expect(output.rounds[0]!.questions.map((question) => question.data.sourceSlidePosition)).toEqual([2, 3, 4, 5, 6]);
    expect(output.rounds[0]!.questions.map((question) => question.data.position)).toEqual([1, 2, 3, 4, 5]);
  });

  test('preserves image, audio, video URLs and video ranges without downloading', async () => {
    const { source, output } = await loadFixture();
    const questions = output.rounds[0]!.questions;
    expect(questions[1]!.data.media).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'image', url: 'https://media.example.test/frame.jpg' }),
    ]));
    expect(questions[2]!.data.media).toEqual([
      expect.objectContaining({ kind: 'audio', url: 'https://audio.example.test/theme.mp3' }),
    ]);
    expect(questions[3]!.data).toMatchObject({ videoStart: 12, videoEnd: 20 });
    expect(source.slides[2]!.media).toEqual(expect.arrayContaining([
      expect.objectContaining({ url: 'not a url', validUrl: false }),
    ]));
  });

  test('detects an unknown slide type and preserves it as legacy', async () => {
    const { source, output } = await loadFixture();
    expect(source.slides[5]!.classification).toBe('legacy');
    expect(source.slides[5]!.unknownFields).toContain('overlayValueFromV1');
    expect(output.rounds[0]!.questions[4]!.data.type).toBe('legacy');
  });

  test('detects lost raw V1 data', async () => {
    const { source, output } = await loadFixture();
    const question = output.rounds[0]!.questions[0]!;
    const legacy = question.data.legacy;
    if (!isJsonObjectValue(legacy) || !isJsonObjectValue(legacy.raw)) throw new Error('Bad test setup');
    const changedLegacy: JsonObject = { ...legacy, raw: { ...legacy.raw, text: 'changed' } };
    const changedQuestion = { ...question, data: { ...question.data, legacy: changedLegacy } };
    const changedRound = {
      ...output.rounds[0]!,
      questions: [changedQuestion, ...output.rounds[0]!.questions.slice(1)],
    };
    const changedOutput: V2QuizDocument = { ...output, rounds: [changedRound] };
    expect(() => validateOutput([source], [changedOutput])).toThrow(MigrationValidationError);
  });

  test('detects a validation count mismatch instead of continuing best effort', async () => {
    const { source, output } = await loadFixture();
    const round = output.rounds[0]!;
    const changedOutput: V2QuizDocument = {
      ...output,
      rounds: [{ ...round, questions: round.questions.slice(0, -1) }],
    };
    expect(() => validateOutput([source], [changedOutput])).toThrow(/question count changed/u);
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
  });
});
