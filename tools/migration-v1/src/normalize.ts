import { MigrationValidationError } from './errors.js';
import type {
  JsonObject,
  JsonValue,
  MediaKind,
  NormalizedMedia,
  NormalizedQuiz,
  NormalizedSlide,
  SlideClassification,
  V1LibrarySnapshot,
} from './types.js';

const slideArrayKeys = ['slides', 'quiz', 'items', 'questions'] as const;
const mappedQuestionTypes = new Set([
  '', 'text', 'question', 'classic', 'free', 'image', 'picture', 'photo', 'audio', 'music',
  'video', 'youtube',
]);
const legacyQuestionTypes = new Set(['pl']);
const contentTypes = new Set(['intro', 'agenda', 'recap', 'end', 'title', 'info']);
const roundTypes = new Set(['round', 'roundheader', 'round-header', 'section']);
const knownSlideFields = new Set([
  'title', 'text', 'type', 'roundHeader', 'options', 'optionsStr', 'correct', 'correctAnswer',
  'note', 'bgImage', 'answerImg', 'media', 'mediaRaw', 'videoStart', 'videoEnd', 'audioTrigger',
  'bgOverlay', 'answerOverlay', 'qCount', 'recapOverrides', 'bgRaw', 'id',
]);

function asString(value: JsonValue | undefined): string {
  return typeof value === 'string' ? value : '';
}

function asNumber(value: JsonValue | undefined): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function isPresent(value: JsonValue | undefined): boolean {
  return value !== undefined && value !== null && (typeof value !== 'string' || value.trim() !== '');
}

function canonicalJson(value: JsonValue): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${canonicalJson(nested)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function resolveCorrectAnswer(slide: JsonObject, position: number): JsonValue | undefined {
  const correctAnswer = isPresent(slide.correctAnswer) ? slide.correctAnswer : undefined;
  const correct = isPresent(slide.correct) ? slide.correct : undefined;
  if (correctAnswer !== undefined && correct !== undefined
    && canonicalJson(correctAnswer) !== canonicalJson(correct)) {
    throw new MigrationValidationError(
      `Slide ${position}: conflicting non-empty correct and correctAnswer values.`,
    );
  }
  return correctAnswer ?? correct;
}

function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return value !== undefined && value !== null && !Array.isArray(value) && typeof value === 'object';
}

function normalizeType(value: JsonValue | undefined): string {
  if (value === undefined) return '';
  if (typeof value !== 'string') return `[non-string-${typeof value}]`;
  return value.trim().toLowerCase();
}

function hasExplicitRoundMarker(slide: JsonObject, sourceType: string): boolean {
  return slide.roundHeader === true || roundTypes.has(sourceType);
}

export function classifyV1Slide(slide: JsonObject): SlideClassification {
  const sourceType = normalizeType(slide.type);
  if (hasExplicitRoundMarker(slide, sourceType)) return 'round';
  if (contentTypes.has(sourceType)) return 'content';
  if (mappedQuestionTypes.has(sourceType) || legacyQuestionTypes.has(sourceType)) return 'question';
  return 'legacy';
}

function isQuestionSlide(slide: JsonObject, classification: SlideClassification): boolean {
  if (classification === 'question') return true;
  if (classification !== 'legacy') return false;
  return isPresent(slide.correctAnswer) || isPresent(slide.correct) || isPresent(slide.qCount);
}

function classifyMedia(sourceField: string, sourceType: string, value: JsonValue): MediaKind {
  if (sourceField === 'bgImage' || sourceField === 'answerImg') return 'image';
  if (sourceField === 'mediaRaw' || sourceField === 'media.src') {
    if (sourceType === 'audio' || sourceType === 'music') return 'audio';
    if (['image', 'picture', 'photo'].includes(sourceType)) return 'image';
    if (sourceType === 'video' || sourceType === 'youtube') return 'video';
  }
  const hint = `${sourceField} ${typeof value === 'string' ? value : ''}`.toLowerCase();
  if (/\.(mp3|wav|ogg|m4a)(?:[?#]|$)|audio|sound|music/.test(hint)) return 'audio';
  if (/\.(mp4|webm|mov)(?:[?#]|$)|youtube|youtu\.be|vimeo|video/.test(hint)) return 'video';
  if (/\.(png|jpe?g|gif|webp|svg)(?:[?#]|$)|image|picture|photo/.test(hint)) return 'image';
  return 'unknown';
}

function mediaRole(sourceField: string): NormalizedMedia['role'] {
  if (sourceField === 'answerImg') return 'answer';
  if (sourceField === 'bgImage') return 'background';
  if (sourceField === 'mediaRaw' || sourceField === 'media.src') return 'prompt';
  return 'unknown';
}

function createMedia(
  sourceField: string,
  sourceType: string,
  value: JsonValue,
  expectUrl: boolean,
): NormalizedMedia {
  let url: string | undefined;
  let domain: string | undefined;
  let validUrl: boolean | undefined;
  if (typeof value === 'string') {
    if (expectUrl || /^[a-z][a-z\d+.-]*:/iu.test(value)) {
      url = value;
      try {
        const parsed = new URL(value);
        validUrl = parsed.protocol === 'http:' || parsed.protocol === 'https:';
        domain = validUrl ? parsed.hostname.toLowerCase() : undefined;
      } catch {
        validUrl = false;
      }
    }
  }
  return {
    sourceField,
    role: mediaRole(sourceField),
    kind: classifyMedia(sourceField, sourceType, value),
    value,
    ...(url === undefined ? {} : { url, validUrl }),
    ...(domain === undefined ? {} : { domain }),
  };
}

function normalizeMedia(slide: JsonObject, sourceType: string): NormalizedMedia[] {
  const result: NormalizedMedia[] = [];
  for (const sourceField of ['bgImage', 'answerImg', 'mediaRaw'] as const) {
    const value = slide[sourceField];
    if (value === undefined || !isPresent(value)) continue;
    result.push(createMedia(sourceField, sourceType, value, true));
  }
  if (isJsonObject(slide.media) && isPresent(slide.media.src)) {
    const value = slide.media.src!;
    if (!result.some((item) => item.role === 'prompt' && item.value === value)) {
      result.push(createMedia('media.src', sourceType, value, false));
    }
  }
  return result;
}

function normalizeOptions(slide: JsonObject): readonly JsonValue[] {
  if (Array.isArray(slide.options)) return slide.options;
  if (typeof slide.optionsStr === 'string') {
    return slide.optionsStr.split(/\r?\n|\|/u).map((option) => option.trim()).filter(Boolean);
  }
  return [];
}

export function normalizeV1Slide(slide: JsonObject, index: number): NormalizedSlide {
  const sourceType = normalizeType(slide.type);
  const classification = classifyV1Slide(slide);
  const correctAnswer = resolveCorrectAnswer(slide, index + 1);
  const recapOverrides = Array.isArray(slide.recapOverrides) ? slide.recapOverrides : undefined;
  return {
    position: index + 1,
    classification,
    isQuestion: isQuestionSlide(slide, classification),
    sourceType,
    roundHeader: asString(slide.roundHeader).trim(),
    title: asString(slide.title),
    text: asString(slide.text),
    options: normalizeOptions(slide),
    ...(isPresent(correctAnswer) ? { correctAnswer } : {}),
    ...(typeof slide.note === 'string' ? { note: slide.note } : {}),
    media: normalizeMedia(slide, sourceType),
    ...(asNumber(slide.videoStart) === undefined ? {} : { videoStart: asNumber(slide.videoStart) }),
    ...(asNumber(slide.videoEnd) === undefined ? {} : { videoEnd: asNumber(slide.videoEnd) }),
    ...(asNumber(slide.audioTrigger) === undefined ? {} : { audioTrigger: asNumber(slide.audioTrigger) }),
    ...(asNumber(slide.bgOverlay) === undefined ? {} : { backgroundOverlay: asNumber(slide.bgOverlay) }),
    ...(asNumber(slide.answerOverlay) === undefined ? {} : { answerOverlay: asNumber(slide.answerOverlay) }),
    ...(typeof slide.qCount === 'string' && slide.qCount !== '' ? { sourceQuestionNumber: slide.qCount } : {}),
    ...(recapOverrides === undefined ? {} : { recapOverrides }),
    raw: slide,
    unknownFields: Object.keys(slide).filter((field) => !knownSlideFields.has(field)).sort(),
  };
}

function parseSlides(candidate: JsonValue | undefined, quizId: string): JsonObject[] | undefined {
  if (!Array.isArray(candidate)) return undefined;
  return candidate.map((slide, index) => {
    if (!isJsonObject(slide)) {
      throw new MigrationValidationError(`Quiz ${quizId} has a non-object slide at position ${index + 1}.`);
    }
    return slide;
  });
}

interface QuizPayload {
  readonly title: string;
  readonly description: string;
  readonly slides: JsonObject[];
  readonly legacyMetadata: JsonObject;
  readonly unknownFields: readonly string[];
}

function extractQuizPayload(data: JsonObject, quizId: string): QuizPayload {
  if (isJsonObject(data.data)) {
    for (const key of slideArrayKeys) {
      const slides = parseSlides(data.data[key], quizId);
      if (slides === undefined) continue;
      const nestedMetadata = Object.fromEntries(
        Object.entries(data.data).filter(([field]) => field !== key),
      );
      const legacyMetadata = {
        ...Object.fromEntries(Object.entries(data).filter(([field]) => field !== 'data')),
        data: nestedMetadata,
      };
      return {
        title: asString(data.title) || asString(data.name) || quizId,
        description: asString(data.description),
        slides,
        legacyMetadata,
        unknownFields: Object.keys(data).filter((field) => !['name', 'title', 'description', 'timestamp', 'data'].includes(field)).sort(),
      };
    }
  }
  for (const key of slideArrayKeys) {
    const slides = parseSlides(data[key], quizId);
    if (slides === undefined) continue;
    return {
      title: asString(data.title) || asString(data.name) || quizId,
      description: asString(data.description),
      slides,
      legacyMetadata: Object.fromEntries(Object.entries(data).filter(([field]) => field !== key)),
      unknownFields: Object.keys(data).filter((field) => !['title', 'name', 'description', key].includes(field)).sort(),
    };
  }
  throw new MigrationValidationError(`Quiz ${quizId} has no supported slide array (${slideArrayKeys.join(', ')}).`);
}

export function normalizeV1Library(snapshot: V1LibrarySnapshot): readonly NormalizedQuiz[] {
  return snapshot.documents.map(({ id, data }) => {
    const payload = extractQuizPayload(data, id);
    return {
      id,
      title: payload.title,
      description: payload.description,
      slides: payload.slides.map(normalizeV1Slide),
      legacyMetadata: payload.legacyMetadata,
      unknownFields: payload.unknownFields,
    };
  });
}

export function isUnknownSlideType(slide: NormalizedSlide): boolean {
  return slide.sourceType !== ''
    && !mappedQuestionTypes.has(slide.sourceType)
    && !legacyQuestionTypes.has(slide.sourceType)
    && !contentTypes.has(slide.sourceType)
    && !roundTypes.has(slide.sourceType);
}

export function isPartiallyMappedSlideType(slide: NormalizedSlide): boolean {
  return legacyQuestionTypes.has(slide.sourceType);
}
