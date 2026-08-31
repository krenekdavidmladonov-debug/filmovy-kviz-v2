import type {
  JsonObject,
  NormalizedMedia,
  NormalizedQuiz,
  NormalizedSlide,
  V2QuestionDocument,
  V2QuizDocument,
  V2RoundDocument,
} from './types.js';

const migrationActor = 'migration-v1-emulator';

function taggedTimestamp(iso: string): JsonObject {
  return { __migrationTimestamp: iso };
}

function pad(position: number): string {
  return String(position).padStart(3, '0');
}

function normalizedMediaValue(media: NormalizedMedia): JsonObject {
  return {
    sourceField: media.sourceField,
    role: media.role,
    kind: media.kind,
    value: media.value,
    ...(media.url === undefined ? {} : { url: media.url, validUrl: media.validUrl ?? false }),
    ...(media.domain === undefined ? {} : { domain: media.domain }),
  };
}

function mapQuestionType(slide: NormalizedSlide): string {
  if (slide.classification === 'legacy') return 'legacy';
  const kinds = new Set(slide.media.map((item) => item.kind));
  if (slide.sourceType.includes('audio') || slide.sourceType === 'music' || kinds.has('audio')) return 'audio';
  if (slide.sourceType.includes('image') || ['picture', 'photo'].includes(slide.sourceType) || kinds.has('image')) return 'image';
  if (slide.sourceType.includes('video') || ['youtube'].includes(slide.sourceType) || kinds.has('video')) return 'legacy';
  return 'text';
}

function mapRoundType(slides: readonly NormalizedSlide[]): string {
  const types = slides.map(mapQuestionType);
  if (types.length > 0 && types.every((type) => type === 'audio')) return 'audio';
  if (types.length > 0 && types.every((type) => type === 'image')) return 'picture';
  return 'classic';
}

function transformQuestion(
  quizId: string,
  roundId: string,
  slide: NormalizedSlide,
  position: number,
): V2QuestionDocument {
  const prompt = slide.text || slide.title;
  const data: JsonObject = {
    prompt,
    type: mapQuestionType(slide),
    position,
    sourceSlidePosition: slide.position,
    options: [...slide.options],
    media: slide.media.map(normalizedMediaValue),
    legacy: {
      source: 'v1',
      classification: slide.classification,
      sourceType: slide.sourceType,
      raw: slide.raw,
    },
  };
  if (slide.correctAnswer !== undefined) data.correctAnswer = slide.correctAnswer;
  if (slide.note !== undefined) data.moderatorNote = slide.note;
  if (slide.videoStart !== undefined) data.videoStart = slide.videoStart;
  if (slide.videoEnd !== undefined) data.videoEnd = slide.videoEnd;
  if (slide.audioTrigger !== undefined) data.audioTrigger = slide.audioTrigger;

  return { id: `slide-${pad(slide.position)}`, quizId, roundId, data };
}

interface RoundGroup {
  readonly header?: NormalizedSlide;
  readonly slides: NormalizedSlide[];
}

export function groupSlidesIntoRounds(slides: readonly NormalizedSlide[]): readonly RoundGroup[] {
  const groups: RoundGroup[] = [];
  let current: RoundGroup | undefined;
  for (const slide of slides) {
    if (slide.classification === 'round') {
      current = { header: slide, slides: [] };
      groups.push(current);
      continue;
    }
    if (current === undefined) {
      current = { slides: [] };
      groups.push(current);
    }
    current.slides.push(slide);
  }
  return groups;
}

function transformRound(quizId: string, group: RoundGroup, position: number): V2RoundDocument {
  const roundId = `round-${pad(position)}`;
  const questions = group.slides.map((slide, index) => transformQuestion(quizId, roundId, slide, index + 1));
  const legacy: JsonObject = group.header === undefined
    ? { source: 'v1', generatedImplicitRound: true }
    : {
        source: 'v1',
        sourceSlidePosition: group.header.position,
        sourceType: group.header.sourceType,
        raw: group.header.raw,
      };
  return {
    id: roundId,
    quizId,
    data: {
      title: group.header?.title || group.header?.text || `Kolo ${position}`,
      position,
      type: mapRoundType(group.slides),
      questionCount: questions.length,
      legacy,
    },
    questions,
  };
}

export function transformQuiz(quiz: NormalizedQuiz, now = new Date()): V2QuizDocument {
  const rounds = groupSlidesIntoRounds(quiz.slides).map((group, index) => transformRound(quiz.id, group, index + 1));
  const questionCount = rounds.reduce((total, round) => total + round.questions.length, 0);
  return {
    id: quiz.id,
    data: {
      title: quiz.title,
      description: quiz.description,
      status: 'draft',
      createdAt: taggedTimestamp(now.toISOString()),
      updatedAt: taggedTimestamp(now.toISOString()),
      createdBy: migrationActor,
      updatedBy: migrationActor,
      roundCount: rounds.length,
      questionCount,
      legacy: {
        source: 'v1',
        metadata: quiz.legacyMetadata,
      },
    },
    rounds,
  };
}

export function transformLibrary(quizzes: readonly NormalizedQuiz[], now = new Date()): readonly V2QuizDocument[] {
  return quizzes.map((quiz) => transformQuiz(quiz, now));
}

export function cloneJsonObject(value: JsonObject): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject;
}

export function isJsonObjectValue(value: unknown): value is JsonObject {
  return value !== undefined && value !== null && !Array.isArray(value) && typeof value === 'object';
}
