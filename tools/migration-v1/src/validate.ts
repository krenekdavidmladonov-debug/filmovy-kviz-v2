import { MigrationValidationError } from './errors.js';
import { isUnknownSlideType } from './normalize.js';
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
  const questionSlides = quiz.slides.filter((slide) => slide.classification !== 'round');
  const media = questionSlides.flatMap((slide) => slide.media);
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
  const media = questions.flatMap((question) => mediaKinds(question.data));
  const sourceRoundSlides = quiz.rounds.filter((round) => {
    const legacy = round.data.legacy;
    return isJsonObjectValue(legacy) && typeof legacy.sourceSlidePosition === 'number';
  }).length;
  return {
    quizzes: 1,
    slides: sourceRoundSlides + questions.length,
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
  if (quizzes.length === 0) {
    throw new MigrationValidationError('The library snapshot contains no quizzes.');
  }
  for (const quiz of quizzes) {
    if (quiz.slides.length === 0) {
      throw new MigrationValidationError(`Quiz ${quiz.id} contains no slides.`);
    }
    for (const slide of quiz.slides) {
      if (slide.videoStart !== undefined && slide.videoEnd !== undefined && slide.videoStart > slide.videoEnd) {
        throw new MigrationValidationError(`Quiz ${quiz.id}, slide ${slide.position}: videoStart is after videoEnd.`);
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

function validateQuizOutput(source: NormalizedQuiz, output: V2QuizDocument): void {
  const sourceGroups = groupSlidesIntoRounds(source.slides);
  if (source.id !== output.id || sourceGroups.length !== output.rounds.length) {
    throw new MigrationValidationError(`Quiz ${source.id}: quiz id or round count changed.`);
  }
  const quizLegacy = output.data.legacy;
  if (!isJsonObjectValue(quizLegacy) || canonical(quizLegacy.metadata) !== canonical(source.legacyMetadata)) {
    throw new MigrationValidationError(`Quiz ${source.id}: legacy quiz metadata was lost or changed.`);
  }
  sourceGroups.forEach((group, roundIndex) => {
    const round = output.rounds[roundIndex];
    if (round === undefined) throw new MigrationValidationError(`Quiz ${source.id}: missing round ${roundIndex + 1}.`);
    if (group.header !== undefined) {
      assertRawPreserved(group.header, round.data.legacy, `${source.id}/round-${roundIndex + 1}`);
    }
    if (group.slides.length !== round.questions.length) {
      throw new MigrationValidationError(`Quiz ${source.id}, round ${roundIndex + 1}: question count changed.`);
    }
    group.slides.forEach((slide, questionIndex) => {
      const question = round.questions[questionIndex];
      if (question === undefined || question.data.sourceSlidePosition !== slide.position) {
        throw new MigrationValidationError(`Quiz ${source.id}: slide order changed at source position ${slide.position}.`);
      }
      assertRawPreserved(slide, question.data.legacy, `${source.id}/slide-${slide.position}`);
      if (canonical(question.data.correctAnswer) !== canonical(slide.correctAnswer)) {
        throw new MigrationValidationError(`Quiz ${source.id}: correct answer changed at slide ${slide.position}.`);
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
    unknownFields: [...unknownFields].sort(),
    mediaDomains: [...new Set(media.flatMap((item) => item.domain === undefined ? [] : [item.domain]))].sort(),
    invalidMediaUrls: media.filter((item) => item.validUrl === false).length,
    errors: [],
  };
}
