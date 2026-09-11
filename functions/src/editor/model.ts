import { mapEditorSlide, directMediaKind, youtubeVideoId, parseQuizAsset } from '@filmovy-kviz/quiz-domain';
import { createHash } from 'node:crypto';

import { QuizEditorError } from './errors.js';
import type {
  EditorMediaInput,
  EditorPresentationInput,
  EditorSlideInput,
  EditorSlideKind,
} from './types.js';

export interface StoredEditorSlide {
  readonly id: string;
  readonly data: Record<string, unknown>;
}

const questionKinds = new Set<EditorSlideKind>([
  'question', 'text', 'classic', 'free', 'image', 'picture', 'photo',
  'audio', 'music', 'video', 'youtube', 'pl', 'legacy',
]);
const roundKinds = new Set<EditorSlideKind>(['round', 'roundheader', 'round-header', 'section']);

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && !Array.isArray(value) && typeof value === 'object';
}

export function quizRevision(data: Record<string, unknown>): number {
  const value = data.revision;
  if (value === undefined) return 0;
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new QuizEditorError('failed-precondition', 'Quiz revision is malformed.');
  }
  return value as number;
}

export function assertRevision(data: Record<string, unknown>, expected: number): number {
  const current = quizRevision(data);
  if (current !== expected) {
    throw new QuizEditorError('aborted', 'The quiz changed in another editor window.');
  }
  return current;
}

export function quizCreationIdentity(actorUid: string, requestId: string, title: string): {
  readonly quizId: string;
  readonly fingerprint: string;
} {
  const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  return {
    quizId: `quiz_${digest([actorUid, requestId])}`,
    fingerprint: digest({ title }),
  };
}

export function isQuestionKind(kind: EditorSlideKind): boolean {
  return questionKinds.has(kind);
}

export function isRoundKind(kind: EditorSlideKind): boolean {
  return roundKinds.has(kind);
}

export function questionTypeForKind(kind: EditorSlideKind): 'text' | 'image' | 'audio' | 'video' | 'legacy' {
  if (kind === 'image' || kind === 'picture' || kind === 'photo') return 'image';
  if (kind === 'audio' || kind === 'music') return 'audio';
  if (kind === 'video' || kind === 'youtube') return 'video';
  if (kind === 'pl' || kind === 'legacy') return 'legacy';
  if (kind === 'question' || kind === 'text' || kind === 'classic' || kind === 'free') return 'text';
  return 'legacy';
}

function mediaUrl(source: string): { readonly url?: string; readonly domain?: string; readonly validUrl?: boolean } {
  try {
    const parsed = new URL(source);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return {};
    return { url: source, domain: parsed.hostname.toLowerCase(), validUrl: true };
  } catch {
    return {};
  }
}

function mergedMediaEntry(existing: unknown, input: EditorMediaInput): Record<string, unknown> {
  const base = isObject(existing) ? { ...existing } : {};
  const previousSource = [base.value, base.source, base.url].find(value => typeof value === 'string');
  const sameRole = input.role === base.role || (input.role === 'unknown' && typeof base.role === 'string');
  const sameKind = input.kind === base.kind || (input.kind === 'unknown' && typeof base.kind === 'string');
  if (previousSource === input.source && sameRole && sameKind) return base;
  delete base.url;
  delete base.domain;
  delete base.validUrl;
  return {
    ...base,
    role: input.role === 'unknown' && typeof base.role === 'string' && base.role !== 'unknown' ? base.role : input.role,
    kind: input.kind === 'unknown' && typeof base.kind === 'string' && base.kind !== 'unknown' ? base.kind : input.kind,
    value: input.source,
    ...mediaUrl(input.source),
  };
}

export function mergeEditorMedia(current: unknown, inputs: readonly EditorMediaInput[]): readonly unknown[] {
  const existing: unknown[] = Array.isArray(current) ? current.map((item: unknown) => item) : [];
  const patches = new Map<number, EditorMediaInput>();
  const additions: EditorMediaInput[] = [];
  for (const input of inputs) {
    if (input.sourceIndex === undefined) additions.push(input);
    else {
      if (input.sourceIndex >= existing.length) {
        throw new QuizEditorError('invalid-argument', 'Media sourceIndex is outside the current slide.');
      }
      patches.set(input.sourceIndex, input);
    }
  }
  const result = existing.flatMap((item, index) => {
    const input = patches.get(index);
    if (input === undefined) return [item];
    return input.source === '' ? [] : [mergedMediaEntry(item, input)];
  });
  for (const input of additions) {
    if (input.source !== '') result.push(mergedMediaEntry(undefined, input));
  }
  return result;
}

export function mergePresentation(current: unknown, input: EditorPresentationInput): Record<string, unknown> {
  const result = isObject(current) ? { ...current } : {};
  for (const [field, value] of Object.entries(input)) {
    const stored = result[field];
    const malformedStoredValue = field === 'sourceQuestionNumber'
      ? stored !== undefined && typeof stored !== 'string'
      : stored !== undefined && (typeof stored !== 'number' || !Number.isFinite(stored));
    if ((value === null || value === '') && malformedStoredValue) continue;
    if (value === null || value === '') delete result[field];
    else result[field] = value;
  }
  return result;
}

function editorText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === undefined || value === null) return '';
  return JSON.stringify(value);
}

function keepMalformedText(current: unknown, input: string): unknown {
  return typeof current !== 'string' && current !== undefined && editorText(current) === input ? current : input;
}

function mergedOptions(current: unknown, input: readonly string[]): readonly unknown[] {
  if (!Array.isArray(current) || current.every((value) => typeof value === 'string')) return [...input];
  if (current.length === input.length && current.every((value, index) => editorText(value) === input[index])) return current;
  return [...input];
}

function applyOptionalNumber(result: Record<string, unknown>, current: Record<string, unknown>, field: string, input: number | null): void {
  const stored = current[field];
  if (input === null) {
    if (stored !== undefined && (typeof stored !== 'number' || !Number.isFinite(stored))) return;
    delete result[field];
  } else result[field] = input;
}

export function applyKnownSlideUpdate(
  current: Record<string, unknown>,
  input: EditorSlideInput,
): Record<string, unknown> {
  const storedKind = typeof current.kind === 'string' ? current.kind : undefined;
  const preserveUnknownKind = input.kind === 'legacy'
    && storedKind !== undefined
    && !questionKinds.has(storedKind as EditorSlideKind)
    && !roundKinds.has(storedKind as EditorSlideKind);
  const result: Record<string, unknown> = {
    ...current,
    kind: preserveUnknownKind ? storedKind : input.kind,
    isQuestion: preserveUnknownKind ? current.isQuestion === true : isQuestionKind(input.kind),
    title: keepMalformedText(current.title, input.title),
    text: keepMalformedText(current.text, input.text),
    options: mergedOptions(current.options, input.options),
    media: mergeEditorMedia(current.media, input.media),
    presentation: mergePresentation(current.presentation, input.presentation),
  };
  if (input.moderatorNote === '' && !Object.hasOwn(current, 'moderatorNote')) delete result.moderatorNote;
  else result.moderatorNote = keepMalformedText(current.moderatorNote, input.moderatorNote);
  if (input.correctAnswer === '' && !Object.hasOwn(current, 'correctAnswer')) delete result.correctAnswer;
  else result.correctAnswer = keepMalformedText(current.correctAnswer, input.correctAnswer);
  const mapped = mapEditorSlide('current', { position: 1, ...current, kind: current.kind ?? input.kind });
  for (const field of ['backgroundImage', 'questionImage', 'answerImage', 'mediaSource'] as const) {
    // Equal mapped values mean no edit, retaining absent, malformed and legacy fields.
    // Explicit empty replacement shadows the legacy role without deleting its history.
    if (mapped[field] !== input[field]) result[field] = input[field];
  }
  const timed = ['audio', 'music', 'video', 'youtube'].includes(input.kind);
  if (timed && input.mediaSource !== '' && mapped.mediaSource !== input.mediaSource && youtubeVideoId(input.mediaSource) === undefined
      && directMediaKind(input.mediaSource) !== (['audio', 'music'].includes(input.kind) ? 'audio' : 'video')
      && !(['audio', 'music'].includes(input.kind) && parseQuizAsset(input.mediaSource))) {
    throw new QuizEditorError('invalid-argument', 'Nepodporovaný zdroj ukázky.');
  }
  if (timed && input.mediaSource !== '' && mapped.mediaSource !== input.mediaSource
      && (input.clipStartSeconds === null || input.clipEndSeconds === null || input.clipEndSeconds <= input.clipStartSeconds)) {
    throw new QuizEditorError('invalid-argument', 'Změna zdroje vyžaduje platný začátek a konec ukázky.');
  }
  applyOptionalNumber(result, current, 'backgroundOverlay', input.backgroundOverlay);
  const preserveLegacyZeroTiming = input.clipStartSeconds === null
    && input.clipEndSeconds === null
    && input.presentation.videoStart === 0
    && input.presentation.videoEnd === 0
    && (current.clipStartSeconds === undefined || current.clipStartSeconds === 0)
    && current.clipEndSeconds === undefined;
  if (!preserveLegacyZeroTiming) {
    applyOptionalNumber(result, current, 'clipStartSeconds', input.clipStartSeconds);
    applyOptionalNumber(result, current, 'clipEndSeconds', input.clipEndSeconds);
  }
  return result;
}

export function createSlideData(
  input: EditorSlideInput,
  position: number,
  roundId?: string,
): Record<string, unknown> {
  return applyKnownSlideUpdate({
    position,
    options: [],
    media: [],
    presentation: {},
    ...(roundId === undefined ? {} : { roundId }),
  }, input);
}

export function duplicateSlideData(current: Record<string, unknown>, position: number): Record<string, unknown> {
  return { ...current, position };
}

export function sortedSlides(slides: readonly StoredEditorSlide[]): readonly StoredEditorSlide[] {
  const result = [...slides].sort((left, right) => Number(left.data.position) - Number(right.data.position));
  result.forEach((slide, index) => {
    if (!Number.isInteger(slide.data.position) || slide.data.position !== index + 1) {
      throw new QuizEditorError('failed-precondition', 'Slide positions must be unique and contiguous.');
    }
  });
  return result;
}
