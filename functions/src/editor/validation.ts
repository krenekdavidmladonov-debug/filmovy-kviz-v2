import { HttpsError } from 'firebase-functions/v2/https';

import { QuizEditorError } from './errors.js';
import {
  editorSlideKinds,
  type EditorMediaInput,
  type EditorMediaKind,
  type EditorMediaRole,
  type EditorPresentationInput,
  type EditorSlideInput,
  type EditorSlideKind,
} from './types.js';

const editorKindSet = new Set<string>(editorSlideKinds);
const mediaKindSet = new Set<EditorMediaKind>(['image', 'audio', 'video', 'unknown']);
const mediaRoleSet = new Set<EditorMediaRole>(['prompt', 'answer', 'background', 'unknown']);

export function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && !Array.isArray(value) && typeof value === 'object';
}

export function requiredId(data: unknown, field: string): string {
  if (!isObject(data) || typeof data[field] !== 'string') {
    throw new HttpsError('invalid-argument', `${field} is required.`);
  }
  const value = data[field];
  if (value.length === 0 || value.length > 1_500 || value.includes('/')) {
    throw new HttpsError('invalid-argument', `${field} is invalid.`);
  }
  return value;
}

export function expectedRevision(data: unknown): number {
  if (!isObject(data) || !Number.isInteger(data.expectedRevision) || (data.expectedRevision as number) < 0) {
    throw new HttpsError('invalid-argument', 'expectedRevision must be a non-negative integer.');
  }
  return data.expectedRevision as number;
}

export function requestedPosition(data: unknown): number {
  if (!isObject(data) || !Number.isInteger(data.position) || (data.position as number) < 1) {
    throw new HttpsError('invalid-argument', 'position must be a positive integer.');
  }
  return data.position as number;
}

export function requestedDirection(data: unknown): -1 | 1 {
  if (!isObject(data) || (data.direction !== -1 && data.direction !== 1)) {
    throw new HttpsError('invalid-argument', 'direction must be -1 or 1.');
  }
  return data.direction;
}

export function requestedSlide(data: unknown): EditorSlideInput {
  if (!isObject(data)) throw new HttpsError('invalid-argument', 'Request data is required.');
  return validateSlideInput(data.slide);
}

function boundedString(value: unknown, field: string, maximum: number, allowEmpty = true): string {
  if (typeof value !== 'string' || value.length > maximum || (!allowEmpty && value.trim().length === 0)) {
    throw new QuizEditorError('invalid-argument', `${field} is invalid.`);
  }
  return value;
}

export function validateQuizMetadata(value: unknown): { readonly title: string; readonly description: string } {
  if (!isObject(value)) throw new QuizEditorError('invalid-argument', 'Quiz metadata is required.');
  return {
    title: boundedString(value.title, 'title', 300, false),
    description: boundedString(value.description, 'description', 5_000),
  };
}

function nullableNumber(value: unknown, field: string, maximum: number): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > maximum) {
    throw new QuizEditorError('invalid-argument', `${field} is invalid.`);
  }
  return value;
}

function validatePresentation(value: unknown): EditorPresentationInput {
  if (!isObject(value)) throw new QuizEditorError('invalid-argument', 'presentation is required.');
  const result: EditorPresentationInput = {
    videoStart: nullableNumber(value.videoStart, 'videoStart', 86_400),
    videoEnd: nullableNumber(value.videoEnd, 'videoEnd', 86_400),
    audioTrigger: nullableNumber(value.audioTrigger, 'audioTrigger', 86_400),
    backgroundOverlay: nullableNumber(value.backgroundOverlay, 'backgroundOverlay', 100),
    answerOverlay: nullableNumber(value.answerOverlay, 'answerOverlay', 100),
    sourceQuestionNumber: value.sourceQuestionNumber === null
      ? null
      : boundedString(value.sourceQuestionNumber, 'sourceQuestionNumber', 100),
  };
  if (result.videoStart !== null && result.videoEnd !== null && result.videoStart > result.videoEnd) {
    throw new QuizEditorError('invalid-argument', 'videoStart must not be greater than videoEnd.');
  }
  return result;
}

function validateMediaSource(source: unknown, role: EditorMediaRole, kind: EditorMediaKind): string {
  const value = boundedString(source, 'media source', 4_096);
  if (value === '') return value;
  let parsed: URL | undefined;
  try {
    parsed = new URL(value);
  } catch {
    parsed = undefined;
  }
  const looksLikeScheme = /^[a-z][a-z\d+.-]*:/iu.test(value);
  if (parsed !== undefined && parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new QuizEditorError('invalid-argument', 'Media URL must use http or https.');
  }
  if (looksLikeScheme && parsed === undefined) {
    throw new QuizEditorError('invalid-argument', 'Media URL is invalid.');
  }
  if ((role === 'background' || role === 'answer' || kind === 'image')
    && (parsed === undefined || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:'))) {
    throw new QuizEditorError('invalid-argument', 'Image media must be an http(s) URL.');
  }
  return value;
}

function validateMedia(value: unknown): readonly EditorMediaInput[] {
  if (!Array.isArray(value) || value.length > 20) {
    throw new QuizEditorError('invalid-argument', 'media must be an array with at most 20 entries.');
  }
  const seenIndexes = new Set<number>();
  return value.map((item) => {
    if (!isObject(item) || !mediaRoleSet.has(item.role as EditorMediaRole)
      || !mediaKindSet.has(item.kind as EditorMediaKind)) {
      throw new QuizEditorError('invalid-argument', 'Media entry is invalid.');
    }
    const sourceIndex = item.sourceIndex;
    if (sourceIndex !== undefined
      && (!Number.isInteger(sourceIndex) || (sourceIndex as number) < 0 || seenIndexes.has(sourceIndex as number))) {
      throw new QuizEditorError('invalid-argument', 'Media sourceIndex is invalid.');
    }
    if (sourceIndex !== undefined) seenIndexes.add(sourceIndex as number);
    const role = item.role as EditorMediaRole;
    const kind = item.kind as EditorMediaKind;
    return {
      ...(sourceIndex === undefined ? {} : { sourceIndex: sourceIndex as number }),
      role,
      kind,
      source: validateMediaSource(item.source, role, kind),
    };
  });
}

export function validateSlideInput(value: unknown): EditorSlideInput {
  if (!isObject(value) || !editorKindSet.has(value.kind as string)) {
    throw new QuizEditorError('invalid-argument', 'Slide type is invalid.');
  }
  if (!Array.isArray(value.options) || value.options.length > 30) {
    throw new QuizEditorError('invalid-argument', 'options must contain at most 30 values.');
  }
  const options = value.options.map((option) => boundedString(option, 'option', 1_000));
  return {
    kind: value.kind as EditorSlideKind,
    title: boundedString(value.title, 'slide title', 500),
    text: boundedString(value.text, 'slide text', 20_000),
    moderatorNote: boundedString(value.moderatorNote, 'moderatorNote', 10_000),
    options,
    correctAnswer: boundedString(value.correctAnswer, 'correctAnswer', 20_000),
    media: validateMedia(value.media),
    presentation: validatePresentation(value.presentation),
  };
}
