import type {
  JsonObject,
  NormalizedMedia,
  NormalizedQuiz,
  NormalizedSlide,
  V2QuestionDocument,
  V2QuizDocument,
  V2RoundDocument,
  V2SlideDocument,
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
  if (slide.sourceType === 'audio' || slide.sourceType === 'music') return 'audio';
  if (['image', 'picture', 'photo'].includes(slide.sourceType)) return 'image';
  if (slide.sourceType === 'video' || slide.sourceType === 'youtube') return 'video';
  if (slide.classification === 'legacy' || slide.sourceType === 'pl') return 'legacy';
  return 'text';
}

function mappedPresentation(slide: NormalizedSlide): JsonObject {
  return {
    ...(slide.videoStart === undefined ? {} : { videoStart: slide.videoStart }),
    ...(slide.videoEnd === undefined ? {} : { videoEnd: slide.videoEnd }),
    ...(slide.audioTrigger === undefined ? {} : { audioTrigger: slide.audioTrigger }),
    ...(slide.backgroundOverlay === undefined ? {} : { backgroundOverlay: slide.backgroundOverlay }),
    ...(slide.answerOverlay === undefined ? {} : { answerOverlay: slide.answerOverlay }),
    ...(slide.sourceQuestionNumber === undefined ? {} : { sourceQuestionNumber: slide.sourceQuestionNumber }),
    ...(slide.recapOverrides === undefined ? {} : { recapOverrides: [...slide.recapOverrides] }),
  };
}

function commonSlideData(slide: NormalizedSlide): JsonObject {
  const data: JsonObject = {
    position: slide.position,
    kind: slide.sourceType || slide.classification,
    isQuestion: slide.isQuestion,
    title: slide.title,
    text: slide.text,
    options: [...slide.options],
    media: slide.media.map(normalizedMediaValue),
    presentation: mappedPresentation(slide),
    legacy: {
      source: 'v1',
      classification: slide.classification,
      sourceType: slide.sourceType,
      raw: slide.raw,
    },
  };
  if (slide.correctAnswer !== undefined) data.correctAnswer = slide.correctAnswer;
  if (slide.note !== undefined) data.moderatorNote = slide.note;
  const backgroundImage = slide.media.find((item) => item.role === 'background' && item.kind === 'image')?.value;
  const questionImage = ['image', 'picture', 'photo'].includes(slide.sourceType)
    ? slide.media.find((item) => item.role === 'prompt' && item.kind === 'image')?.value
    : undefined;
  const answerImage = slide.media.find((item) => item.role === 'answer' && item.kind === 'image')?.value;
  const mediaKind = ['audio', 'music'].includes(slide.sourceType) ? 'audio'
    : ['video', 'youtube'].includes(slide.sourceType) ? 'video' : undefined;
  const mediaSource = mediaKind === undefined
    ? undefined
    : slide.media.find((item) => item.role === 'prompt' && item.kind === mediaKind)?.value;
  if (backgroundImage !== undefined) data.backgroundImage = backgroundImage;
  if (questionImage !== undefined) data.questionImage = questionImage;
  if (answerImage !== undefined) data.answerImage = answerImage;
  if (mediaSource !== undefined) data.mediaSource = mediaSource;
  if (slide.backgroundOverlay !== undefined) data.backgroundOverlay = slide.backgroundOverlay;
  if (slide.videoStart !== undefined && slide.videoStart >= 0) data.clipStartSeconds = slide.videoStart;
  if (slide.videoEnd !== undefined && slide.videoEnd > (slide.videoStart ?? 0)) data.clipEndSeconds = slide.videoEnd;
  return data;
}

function transformQuestion(
  quizId: string,
  roundId: string,
  slide: NormalizedSlide,
  position: number,
): V2QuestionDocument {
  const data = commonSlideData(slide);
  data.prompt = slide.text || slide.title;
  data.type = mapQuestionType(slide);
  data.position = position;
  data.sourceSlideId = `slide-${pad(slide.position)}`;
  data.sourceSlidePosition = slide.position;
  delete data.kind;
  delete data.isQuestion;
  delete data.title;
  delete data.text;
  delete data.presentation;
  const presentation = mappedPresentation(slide);
  Object.assign(data, presentation);
  return { id: `slide-${pad(slide.position)}`, quizId, roundId, data };
}

interface SlideSegment {
  readonly header: string;
  readonly explicit: boolean;
  readonly slides: NormalizedSlide[];
}

export interface RoundGroup {
  readonly title: string;
  readonly slides: readonly NormalizedSlide[];
  readonly questions: readonly NormalizedSlide[];
  readonly generatedImplicitRound: boolean;
}

function segmentSlides(slides: readonly NormalizedSlide[]): readonly SlideSegment[] {
  const segments: SlideSegment[] = [];
  let current: SlideSegment | undefined;
  for (const slide of slides) {
    const explicitBoundary = slide.classification === 'round';
    const headerTransition = current !== undefined
      && slide.roundHeader !== current.header
      && (slide.roundHeader !== '' || !current.explicit);
    const shouldStart = current === undefined
      || explicitBoundary
      || headerTransition;
    if (shouldStart) {
      const header = explicitBoundary
        ? slide.roundHeader || slide.title || slide.text
        : slide.roundHeader;
      current = { header, explicit: explicitBoundary, slides: [] };
      segments.push(current);
    }
    current!.slides.push(slide);
  }
  return segments;
}

export function groupSlidesIntoRounds(slides: readonly NormalizedSlide[]): readonly RoundGroup[] {
  return segmentSlides(slides)
    .filter((segment) => segment.explicit || segment.slides.some((slide) => slide.isQuestion))
    .map((segment, index) => ({
      title: segment.header
        || segment.slides.find((slide) => slide.classification === 'round')?.title
        || `Kolo ${index + 1}`,
      slides: segment.slides,
      questions: segment.slides.filter((slide) => slide.isQuestion),
      generatedImplicitRound: segment.header === '' && !segment.explicit,
    }));
}

function mapRoundType(slides: readonly NormalizedSlide[]): string {
  const types = slides.map(mapQuestionType);
  if (types.length > 0 && types.every((type) => type === 'audio')) return 'audio';
  if (types.length > 0 && types.every((type) => type === 'image')) return 'picture';
  return 'classic';
}

function transformRound(quizId: string, group: RoundGroup, position: number): V2RoundDocument {
  const roundId = `round-${pad(position)}`;
  const questions = group.questions.map((slide, index) => transformQuestion(quizId, roundId, slide, index + 1));
  return {
    id: roundId,
    quizId,
    data: {
      title: group.title,
      position,
      type: mapRoundType(group.questions),
      slideCount: group.slides.length,
      questionCount: questions.length,
      sourceSlideStart: group.slides[0]?.position ?? 0,
      sourceSlideEnd: group.slides.at(-1)?.position ?? 0,
      legacy: {
        source: 'v1',
        generatedImplicitRound: group.generatedImplicitRound,
      },
    },
    questions,
  };
}

function transformSlide(
  quizId: string,
  slide: NormalizedSlide,
  roundId?: string,
  roundTitle?: string,
  questionNumber?: number,
  questionCount?: number,
): V2SlideDocument {
  const data = commonSlideData(slide);
  if (roundId !== undefined) data.roundId = roundId;
  if (roundTitle !== undefined) data.roundTitle = roundTitle;
  if (questionNumber !== undefined) data.questionNumber = questionNumber;
  if (questionCount !== undefined) data.questionCount = questionCount;
  return {
    id: `slide-${pad(slide.position)}`,
    quizId,
    ...(roundId === undefined ? {} : { roundId }),
    data,
  };
}

export function transformQuiz(quiz: NormalizedQuiz, now = new Date()): V2QuizDocument {
  const groups = groupSlidesIntoRounds(quiz.slides);
  const rounds = groups.map((group, index) => transformRound(quiz.id, group, index + 1));
  const roundBySlidePosition = new Map<number, string>();
  const roundTitleBySlidePosition = new Map<number, string>();
  const questionNumberBySlidePosition = new Map<number, number>();
  const questionCountBySlidePosition = new Map<number, number>();
  groups.forEach((group, index) => {
    const roundId = rounds[index]!.id;
    group.slides.forEach((slide) => {
      roundBySlidePosition.set(slide.position, roundId);
      roundTitleBySlidePosition.set(slide.position, group.title);
    });
    group.questions.forEach((slide, questionIndex) => {
      questionNumberBySlidePosition.set(slide.position, questionIndex + 1);
      questionCountBySlidePosition.set(slide.position, group.questions.length);
    });
  });
  const slides = quiz.slides.map((slide) => transformSlide(
    quiz.id,
    slide,
    roundBySlidePosition.get(slide.position),
    roundTitleBySlidePosition.get(slide.position),
    questionNumberBySlidePosition.get(slide.position),
    questionCountBySlidePosition.get(slide.position),
  ));
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
      slideCount: slides.length,
      roundCount: rounds.length,
      questionCount,
      legacy: {
        source: 'v1',
        metadata: quiz.legacyMetadata,
      },
    },
    slides,
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
