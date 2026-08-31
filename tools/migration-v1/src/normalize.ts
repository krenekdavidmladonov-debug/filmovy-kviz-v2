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
const knownQuizFields = new Set(['title', 'name', 'description', ...slideArrayKeys]);
const knownSlideFields = new Set([
  'title', 'text', 'type', 'roundHeader', 'options', 'optionsStr', 'correct', 'correctAnswer',
  'note', 'bgImage', 'answerImg', 'mediaRaw', 'videoStart', 'videoEnd', 'audioTrigger',
]);
const knownTypes = new Set([
  '', 'text', 'question', 'classic', 'image', 'picture', 'photo', 'audio', 'music',
  'video', 'youtube', 'round', 'roundheader', 'round-header', 'section', 'title', 'info',
]);

function asString(value: JsonValue | undefined): string {
  return typeof value === 'string' ? value : '';
}

function asNumber(value: JsonValue | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function isPresent(value: JsonValue | undefined): boolean {
  return value !== undefined && value !== null && value !== '';
}

function normalizeType(value: JsonValue | undefined): string {
  if (value === undefined) return '';
  if (typeof value !== 'string') return `[non-string-${typeof value}]`;
  return value.trim().toLowerCase();
}

function isRoundHeader(slide: JsonObject, sourceType: string): boolean {
  const marker = slide.roundHeader;
  return (marker !== undefined && marker !== null && marker !== false && marker !== '')
    || ['round', 'roundheader', 'round-header', 'section'].includes(sourceType);
}

export function classifyV1Slide(slide: JsonObject): SlideClassification {
  const sourceType = normalizeType(slide.type);
  if (isRoundHeader(slide, sourceType)) {
    return 'round';
  }
  if (sourceType !== '' && !knownTypes.has(sourceType)) {
    return 'legacy';
  }
  if (['title', 'info'].includes(sourceType) && !isPresent(slide.correct) && !isPresent(slide.correctAnswer)) {
    return 'legacy';
  }
  return 'question';
}

function classifyMedia(sourceField: string, value: JsonValue): MediaKind {
  const hint = `${sourceField} ${typeof value === 'string' ? value : ''}`.toLowerCase();
  if (/\.(mp3|wav|ogg|m4a)(?:[?#]|$)|audio|sound|music/.test(hint)) return 'audio';
  if (/\.(mp4|webm|mov)(?:[?#]|$)|youtube|youtu\.be|vimeo|video/.test(hint)) return 'video';
  if (/\.(png|jpe?g|gif|webp|svg)(?:[?#]|$)|image|picture|photo|bgimage|answerimg/.test(hint)) return 'image';
  return 'unknown';
}

function mediaRole(sourceField: string): NormalizedMedia['role'] {
  if (sourceField === 'answerImg') return 'answer';
  if (sourceField === 'bgImage') return 'background';
  if (sourceField === 'mediaRaw') return 'prompt';
  return 'unknown';
}

function leafMediaValues(value: JsonValue): JsonValue[] {
  if (Array.isArray(value)) return value.flatMap(leafMediaValues);
  if (value !== null && typeof value === 'object') return Object.values(value).flatMap(leafMediaValues);
  return isPresent(value) ? [value] : [];
}

function normalizeMedia(slide: JsonObject): NormalizedMedia[] {
  const result: NormalizedMedia[] = [];
  for (const sourceField of ['bgImage', 'answerImg', 'mediaRaw'] as const) {
    const sourceValue = slide[sourceField];
    if (sourceValue === undefined) continue;
    for (const value of leafMediaValues(sourceValue)) {
      let url: string | undefined;
      let domain: string | undefined;
      let validUrl: boolean | undefined;
      if (typeof value === 'string') {
        url = value;
        try {
          const parsed = new URL(value);
          validUrl = parsed.protocol === 'http:' || parsed.protocol === 'https:';
          domain = validUrl ? parsed.hostname.toLowerCase() : undefined;
        } catch {
          validUrl = false;
        }
      }
      result.push({
        sourceField,
        role: mediaRole(sourceField),
        kind: classifyMedia(sourceField, value),
        value,
        ...(url === undefined ? {} : { url, validUrl }),
        ...(domain === undefined ? {} : { domain }),
      });
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
  const correctAnswer = slide.correctAnswer ?? slide.correct;
  return {
    position: index + 1,
    classification: classifyV1Slide(slide),
    sourceType,
    title: asString(slide.title),
    text: asString(slide.text),
    options: normalizeOptions(slide),
    ...(correctAnswer === undefined ? {} : { correctAnswer }),
    ...(typeof slide.note === 'string' ? { note: slide.note } : {}),
    media: normalizeMedia(slide),
    ...(asNumber(slide.videoStart) === undefined ? {} : { videoStart: asNumber(slide.videoStart) }),
    ...(asNumber(slide.videoEnd) === undefined ? {} : { videoEnd: asNumber(slide.videoEnd) }),
    ...(slide.audioTrigger === undefined ? {} : { audioTrigger: slide.audioTrigger }),
    raw: slide,
    unknownFields: Object.keys(slide).filter((field) => !knownSlideFields.has(field)).sort(),
  };
}

function extractSlides(data: JsonObject, quizId: string): { key: string; slides: JsonObject[] } {
  for (const key of slideArrayKeys) {
    const candidate = data[key];
    if (!Array.isArray(candidate)) continue;
    const slides = candidate.map((slide, index) => {
      if (slide === null || Array.isArray(slide) || typeof slide !== 'object') {
        throw new MigrationValidationError(`Quiz ${quizId} has a non-object slide at position ${index + 1}.`);
      }
      return slide;
    });
    return { key, slides };
  }
  throw new MigrationValidationError(`Quiz ${quizId} has no supported slide array (${slideArrayKeys.join(', ')}).`);
}

export function normalizeV1Library(snapshot: V1LibrarySnapshot): readonly NormalizedQuiz[] {
  return snapshot.documents.map(({ id, data }) => {
    const { key: slideKey, slides } = extractSlides(data, id);
    const legacyMetadata = Object.fromEntries(
      Object.entries(data).filter(([field]) => field !== slideKey),
    );
    return {
      id,
      title: asString(data.title) || asString(data.name) || id,
      description: asString(data.description),
      slides: slides.map(normalizeV1Slide),
      legacyMetadata,
      unknownFields: Object.keys(data).filter((field) => !knownQuizFields.has(field)).sort(),
    };
  });
}

export function isUnknownSlideType(slide: NormalizedSlide): boolean {
  return slide.sourceType !== '' && !knownTypes.has(slide.sourceType);
}
