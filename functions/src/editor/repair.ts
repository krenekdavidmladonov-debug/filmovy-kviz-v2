import { QuizEditorError } from './errors.js';
import type { StoredEditorSlide } from './model.js';

export type PreflightRepairAction =
  | { readonly kind: 'choice-answer'; readonly optionIndex: number }
  | { readonly kind: 'video-timing'; readonly clipStartSeconds: number; readonly clipEndSeconds: number };

export interface AppliedPreflightRepair {
  readonly slide: StoredEditorSlide;
  readonly kind: PreflightRepairAction['kind'];
  readonly privateCorrectAnswer?: string;
}

const choiceKinds = new Set(['question', 'text', 'classic']);
const videoKinds = new Set(['video', 'youtube']);
const maximumClipSeconds = 86_400;

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && !Array.isArray(value) && typeof value === 'object';
}

function assertExactKeys(data: Record<string, unknown>, expected: readonly string[]): void {
  const expectedKeys = new Set(expected);
  if (Object.keys(data).some((key) => !expectedKeys.has(key))) {
    throw new QuizEditorError('invalid-argument', 'Repair request contains unsupported fields.');
  }
}

export function requestedPreflightRepair(data: unknown): PreflightRepairAction {
  if (!isObject(data)) throw new QuizEditorError('invalid-argument', 'Repair request is required.');
  if (data.kind === 'choice-answer') {
    assertExactKeys(data, ['quizId', 'slideId', 'expectedRevision', 'kind', 'optionIndex']);
    if (!Number.isInteger(data.optionIndex) || (data.optionIndex as number) < 0 || (data.optionIndex as number) >= 30) {
      throw new QuizEditorError('invalid-argument', 'optionIndex is invalid.');
    }
    return { kind: 'choice-answer', optionIndex: data.optionIndex as number };
  }
  if (data.kind === 'video-timing') {
    assertExactKeys(data, ['quizId', 'slideId', 'expectedRevision', 'kind', 'clipStartSeconds', 'clipEndSeconds']);
    const start = data.clipStartSeconds;
    const end = data.clipEndSeconds;
    if (typeof start !== 'number' || !Number.isFinite(start) || start < 0 || start > maximumClipSeconds
      || typeof end !== 'number' || !Number.isFinite(end) || end <= start || end > maximumClipSeconds) {
      throw new QuizEditorError('invalid-argument', 'Video timing must satisfy 0 <= START < END <= 86400.');
    }
    return { kind: 'video-timing', clipStartSeconds: start, clipEndSeconds: end };
  }
  throw new QuizEditorError('invalid-argument', 'Repair kind is invalid.');
}

function normalizedOption(value: string): string {
  return value.trim().toLocaleLowerCase('cs-CZ');
}

function hasStoredVideoSource(data: Record<string, unknown>): boolean {
  if (typeof data.mediaSource === 'string' && data.mediaSource.trim() !== '') return true;
  if (!Array.isArray(data.media)) return false;
  return data.media.some((entry: unknown) => isObject(entry)
    && entry.role === 'prompt'
    && (entry.kind === 'video' || entry.kind === 'unknown')
    && ((typeof entry.value === 'string' && entry.value.trim() !== '')
      || (typeof entry.source === 'string' && entry.source.trim() !== '')));
}

export function applyPreflightRepair(
  current: StoredEditorSlide,
  action: PreflightRepairAction,
): AppliedPreflightRepair {
  const storedKind = typeof current.data.kind === 'string' ? current.data.kind.toLowerCase() : '';
  if (current.data.isQuestion !== true) {
    throw new QuizEditorError('failed-precondition', 'The selected slide is no longer a question.');
  }

  if (action.kind === 'choice-answer') {
    if (!choiceKinds.has(storedKind) || !Array.isArray(current.data.options)
      || current.data.options.length < 2 || !current.data.options.every((option) => typeof option === 'string')) {
      throw new QuizEditorError('failed-precondition', 'The selected question is no longer a supported Choice question.');
    }
    const option = current.data.options[action.optionIndex];
    if (typeof option !== 'string' || option.trim() === '') {
      throw new QuizEditorError('invalid-argument', 'The selected option no longer exists.');
    }
    const matchCount = current.data.options.filter((candidate) => (
      typeof candidate === 'string'
      && normalizedOption(candidate) !== ''
      && normalizedOption(candidate) === normalizedOption(option)
    )).length;
    if (matchCount !== 1) {
      throw new QuizEditorError('failed-precondition', 'The selected option does not identify exactly one stored value.');
    }
    return {
      kind: action.kind,
      privateCorrectAnswer: option,
      slide: { id: current.id, data: { ...current.data, correctAnswer: option } },
    };
  }

  if (!videoKinds.has(storedKind) || !hasStoredVideoSource(current.data)) {
    throw new QuizEditorError('failed-precondition', 'The selected question is no longer a supported Video question with a source.');
  }
  return {
    kind: action.kind,
    slide: {
      id: current.id,
      data: {
        ...current.data,
        clipStartSeconds: action.clipStartSeconds,
        clipEndSeconds: action.clipEndSeconds,
      },
    },
  };
}
