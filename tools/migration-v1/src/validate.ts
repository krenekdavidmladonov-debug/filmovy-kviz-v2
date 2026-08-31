import { MigrationValidationError } from './errors.js';
import { isPartiallyMappedSlideType, isUnknownSlideType } from './normalize.js';
import { groupSlidesIntoRounds, isJsonObjectValue } from './transform.js';
import type {
  JsonObject,
  MigrationStats,
  NormalizedQuiz,
  NormalizedSlide,
  QuizMigrationReport,
  V2QuizDocument,
} from './types.js';

const zeroStats = (): MigrationStats => ({
  quizzes: 0,
  slides: 0,
  rounds: 0,
  questions: 0,
  correctAnswers: 0,
  images: 0,
  audio: 0,
  video: 0,
});

function addStats(left: MigrationStats, right: MigrationStats): MigrationStats {
  return {
    quizzes: left.quizzes + right.quizzes,
    slides: left.slides + right.slides,
    rounds: left.rounds + right.rounds,
    questions: left.questions + right.questions,
    correctAnswers: left.correctAnswers + right.correctAnswers,
    images: left.images + right.images,
    audio: left.audio + right.audio,
    video: left.video + right.video,
  };
}

function sourceStats(quiz: NormalizedQuiz): MigrationStats {
  const questionSlides = quiz.slides.filter((slide) => slide.isQuestion);
  const media = quiz.slides.flatMap((slide) => slide.media);
  return {
    quizzes: 1,
    slides: quiz.slides.length,
    rounds: groupSlidesIntoRounds(quiz.slides).length,
    questions: questionSlides.length,
    correctAnswers: questionSlides.filter((slide) => slide.correctAnswer !== undefined).length,
    images: media.filter((item) => item.kind === 'image').length,
    audio: media.filter((item) => item.kind === 'audio').length,
    video: media.filter((item) => item.kind === 'video').length,
  };
}

function mediaKinds(data: JsonObject): string[] {
  const media = data.media;
  if (!Array.isArray(media)) return [];
  return media.flatMap((item) => {
    if (!isJsonObjectValue(item) || typeof item.kind !== 'string') return [];
    return [item.kind];
  });
}

function outputStats(quiz: V2QuizDocument): MigrationStats {
  const questions = quiz.rounds.flatMap((round) => round.questions);
  const media = quiz.slides.flatMap((slide) => mediaKinds(slide.data));
  return {
    quizzes: 1,
    slides: quiz.slides.length,
    rounds: quiz.rounds.length,
    questions: questions.length,
    correctAnswers: questions.filter((question) => question.data.correctAnswer !== undefined).length,
    images: media.filter((kind) => kind === 'image').length,
    audio: media.filter((kind) => kind === 'audio').length,
    video: media.filter((kind) => kind === 'video').length,
  };
}

export function calculateSourceStats(quizzes: readonly NormalizedQuiz[]): MigrationStats {
  return quizzes.reduce((total, quiz) => addStats(total, sourceStats(quiz)), zeroStats());
}

export function calculateOutputStats(quizzes: readonly V2QuizDocument[]): MigrationStats {
  return quizzes.reduce((total, quiz) => addStats(total, outputStats(quiz)), zeroStats());
}

export function validateNormalizedInput(quizzes: readonly NormalizedQuiz[]): void {
  if (quizzes.length === 0) throw new MigrationValidationError('The library snapshot contains no quizzes.');
  for (const quiz of quizzes) {
    if (quiz.slides.length === 0) throw new MigrationValidationError(`Quiz ${quiz.id} contains no slides.`);
    for (const slide of quiz.slides) {
      if (slide.videoStart !== undefined && slide.videoEnd !== undefined && slide.videoStart > slide.videoEnd) {
        throw new MigrationValidationError(`Quiz ${quiz.id}, slide ${slide.position}: videoStart is after videoEnd.`);
      }
      if (slide.isQuestion && slide.correctAnswer === undefined) {
        throw new MigrationValidationError(`Quiz ${quiz.id}, slide ${slide.position}: question has no preserved correct answer.`);
      }
    }
  }
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${canonical(nested)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function assertRawPreserved(source: NormalizedSlide, outputLegacy: unknown, location: string): void {
  if (!isJsonObjectValue(outputLegacy) || canonical(outputLegacy.raw) !== canonical(source.raw)) {
    throw new MigrationValidationError(`Lost or changed V1 slide data at ${location}.`);
  }
}

function expectedMedia(source: NormalizedSlide): JsonObject[] {
  return source.media.map((media) => ({
    sourceField: media.sourceField,
    role: media.role,
    kind: media.kind,
    value: media.value,
    ...(media.url === undefined ? {} : { url: media.url, validUrl: media.validUrl ?? false }),
    ...(media.domain === undefined ? {} : { domain: media.domain }),
  }));
}

function expectedPresentation(source: NormalizedSlide): JsonObject {
  return {
    ...(source.videoStart === undefined ? {} : { videoStart: source.videoStart }),
    ...(source.videoEnd === undefined ? {} : { videoEnd: source.videoEnd }),
    ...(source.audioTrigger === undefined ? {} : { audioTrigger: source.audioTrigger }),
    ...(source.backgroundOverlay === undefined ? {} : { backgroundOverlay: source.backgroundOverlay }),
    ...(source.answerOverlay === undefined ? {} : { answerOverlay: source.answerOverlay }),
    ...(source.sourceQuestionNumber === undefined ? {} : { sourceQuestionNumber: source.sourceQuestionNumber }),
    ...(source.recapOverrides === undefined ? {} : { recapOverrides: [...source.recapOverrides] }),
  };
}

function expectedQuestionType(source: NormalizedSlide): string {
  if (['audio', 'music'].includes(source.sourceType)) return 'audio';
  if (['image', 'picture', 'photo'].includes(source.sourceType)) return 'image';
  if (['video', 'youtube'].includes(source.sourceType)) return 'video';
  if (source.classification === 'legacy' || source.sourceType === 'pl') return 'legacy';
  return 'text';
}

function expectedRoundType(questions: readonly NormalizedSlide[]): string {
  const types = questions.map(expectedQuestionType);
  if (types.length > 0 && types.every((type) => type === 'audio')) return 'audio';
  if (types.length > 0 && types.every((type) => type === 'image')) return 'picture';
  return 'classic';
}

function assertCanonicalEqual(actual: unknown, expected: unknown, message: string): void {
  if (canonical(actual) !== canonical(expected)) throw new MigrationValidationError(message);
}

function validateMappedSlide(source: NormalizedSlide, output: JsonObject, location: string): void {
  const expected: JsonObject = {
    position: source.position,
    kind: source.sourceType || source.classification,
    isQuestion: source.isQuestion,
    title: source.title,
    text: source.text,
    options: [...source.options],
    media: expectedMedia(source),
    presentation: expectedPresentation(source),
  };
  if (source.correctAnswer !== undefined) expected.correctAnswer = source.correctAnswer;
  if (source.note !== undefined) expected.moderatorNote = source.note;
  for (const [field, value] of Object.entries(expected)) {
    assertCanonicalEqual(output[field], value, `Mapped ${field} changed at ${location}.`);
  }
}

function validateMappedQuestion(
  source: NormalizedSlide,
  output: JsonObject,
  location: string,
  position: number,
): void {
  const expected: JsonObject = {
    position,
    prompt: source.text || source.title,
    type: expectedQuestionType(source),
    sourceSlideId: `slide-${String(source.position).padStart(3, '0')}`,
    sourceSlidePosition: source.position,
    options: [...source.options],
    media: expectedMedia(source),
    ...expectedPresentation(source),
  };
  if (source.correctAnswer !== undefined) expected.correctAnswer = source.correctAnswer;
  if (source.note !== undefined) expected.moderatorNote = source.note;
  for (const [field, value] of Object.entries(expected)) {
    assertCanonicalEqual(output[field], value, `Mapped question ${field} changed at ${location}.`);
  }
}

function validateQuizOutput(source: NormalizedQuiz, output: V2QuizDocument): void {
  const sourceGroups = groupSlidesIntoRounds(source.slides);
  if (source.id !== output.id || sourceGroups.length !== output.rounds.length) {
    throw new MigrationValidationError(`Quiz ${source.id}: quiz id or round count changed.`);
  }
  const quizLegacy = output.data.legacy;
  if (!isJsonObjectValue(quizLegacy) || canonical(quizLegacy.metadata) !== canonical(source.legacyMetadata)) {
    throw new MigrationValidationError(`Quiz ${source.id}: legacy quiz metadata was lost or changed.`);
  }
  if (source.slides.length !== output.slides.length) {
    throw new MigrationValidationError(`Quiz ${source.id}: slide count changed.`);
  }
  const expectedRoundBySlide = new Map<number, string>();
  sourceGroups.forEach((group, roundIndex) => {
    const round = output.rounds[roundIndex];
    const roundId = `round-${String(roundIndex + 1).padStart(3, '0')}`;
    if (round === undefined || round.id !== roundId) {
      throw new MigrationValidationError(`Quiz ${source.id}: round order/id changed at round ${roundIndex + 1}.`);
    }
    const expectedRound: JsonObject = {
      title: group.title,
      position: roundIndex + 1,
      type: expectedRoundType(group.questions),
      slideCount: group.slides.length,
      questionCount: group.questions.length,
      sourceSlideStart: group.slides[0]?.position ?? 0,
      sourceSlideEnd: group.slides.at(-1)?.position ?? 0,
      legacy: {
        source: 'v1',
        generatedImplicitRound: group.generatedImplicitRound,
      },
    };
    for (const [field, value] of Object.entries(expectedRound)) {
      assertCanonicalEqual(round.data[field], value, `Quiz ${source.id}: mapped round ${field} changed.`);
    }
    group.slides.forEach((slide) => expectedRoundBySlide.set(slide.position, roundId));
  });
  source.slides.forEach((slide, index) => {
    const outputSlide = output.slides[index];
    if (outputSlide === undefined || outputSlide.data.position !== slide.position) {
      throw new MigrationValidationError(`Quiz ${source.id}: slide order changed at source position ${slide.position}.`);
    }
    assertRawPreserved(slide, outputSlide.data.legacy, `${source.id}/slide-${slide.position}`);
    validateMappedSlide(slide, outputSlide.data, `${source.id}/slide-${slide.position}`);
    assertCanonicalEqual(
      outputSlide.data.roundId,
      expectedRoundBySlide.get(slide.position),
      `Quiz ${source.id}: round assignment changed at slide ${slide.position}.`,
    );
    if (canonical(outputSlide.data.correctAnswer) !== canonical(slide.correctAnswer)) {
      throw new MigrationValidationError(`Quiz ${source.id}: correct answer changed at slide ${slide.position}.`);
    }
  });
  sourceGroups.forEach((group, roundIndex) => {
    const round = output.rounds[roundIndex];
    if (round === undefined) throw new MigrationValidationError(`Quiz ${source.id}: missing round ${roundIndex + 1}.`);
    if (group.questions.length !== round.questions.length) {
      throw new MigrationValidationError(`Quiz ${source.id}, round ${roundIndex + 1}: question count changed.`);
    }
    group.questions.forEach((slide, questionIndex) => {
      const question = round.questions[questionIndex];
      if (question === undefined || question.data.sourceSlidePosition !== slide.position) {
        throw new MigrationValidationError(`Quiz ${source.id}: question order changed at source slide ${slide.position}.`);
      }
      assertRawPreserved(slide, question.data.legacy, `${source.id}/question-${slide.position}`);
      validateMappedQuestion(slide, question.data, `${source.id}/question-${slide.position}`, questionIndex + 1);
      if (canonical(question.data.correctAnswer) !== canonical(slide.correctAnswer)) {
        throw new MigrationValidationError(`Quiz ${source.id}: private correct answer changed at slide ${slide.position}.`);
      }
    });
  });
}

export function validateOutput(source: readonly NormalizedQuiz[], output: readonly V2QuizDocument[]): void {
  if (source.length !== output.length) throw new MigrationValidationError('Quiz count changed during transformation.');
  source.forEach((quiz, index) => {
    const outputQuiz = output[index];
    if (outputQuiz === undefined) throw new MigrationValidationError(`Missing output for quiz ${quiz.id}.`);
    validateQuizOutput(quiz, outputQuiz);
  });
  const before = calculateSourceStats(source);
  const after = calculateOutputStats(output);
  if (canonical(before) !== canonical(after)) {
    throw new MigrationValidationError(`Migration totals mismatch: before=${JSON.stringify(before)} after=${JSON.stringify(after)}.`);
  }
}

export function createQuizReport(source: NormalizedQuiz, output: V2QuizDocument): QuizMigrationReport {
  const unknownSlideTypes = source.slides.filter(isUnknownSlideType).map((slide) => slide.sourceType);
  const media = source.slides.flatMap((slide) => slide.media);
  const unknownFields = new Set([
    ...source.unknownFields,
    ...source.slides.flatMap((slide) => slide.unknownFields),
  ]);
  return {
    quizId: source.id,
    status: 'PASS',
    before: sourceStats(source),
    after: outputStats(output),
    unknownSlideTypes: [...new Set(unknownSlideTypes)].sort(),
    partiallyMappedSlideTypes: [...new Set(source.slides.filter(isPartiallyMappedSlideType)
      .map((slide) => slide.sourceType))].sort(),
    unknownFields: [...unknownFields].sort(),
    mediaDomains: [...new Set(media.flatMap((item) => item.domain === undefined ? [] : [item.domain]))].sort(),
    invalidMediaUrls: media.filter((item) => item.validUrl === false).length,
    errors: [],
  };
}
