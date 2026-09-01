import type { DocumentData } from 'firebase/firestore';

import type {
  LiveControlSlide,
  LiveControlState,
  LiveSessionStatus,
  PublicLiveState,
  PublicMedia,
} from './types';

function requiredString(data: DocumentData, field: string): string {
  const value: unknown = data[field];
  if (typeof value !== 'string') throw new Error(`Invalid live field: ${field}`);
  return value;
}

function requiredNumber(data: DocumentData, field: string): number {
  const value: unknown = data[field];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Invalid live field: ${field}`);
  }
  return value;
}

function status(data: DocumentData): LiveSessionStatus {
  const value = requiredString(data, 'status');
  if (value !== 'waiting' && value !== 'active' && value !== 'ended') {
    throw new Error('Invalid live field: status');
  }
  return value;
}

function optionalString(data: DocumentData, field: string): string | undefined {
  const value: unknown = data[field];
  return typeof value === 'string' ? value : undefined;
}

function stringArray(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function publicMedia(value: unknown): readonly PublicMedia[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (item === null || Array.isArray(item) || typeof item !== 'object') return [];
    const media = item as Record<string, unknown>;
    const role = media.role;
    const kind = media.kind;
    const source = media.source;
    if ((role !== 'prompt' && role !== 'background')
      || !['image', 'audio', 'video', 'unknown'].includes(String(kind))
      || typeof source !== 'string') return [];
    return [{ role, kind: kind as PublicMedia['kind'], source }];
  });
}

export function mapLiveControlState(id: string, data: DocumentData): LiveControlState {
  return {
    sessionId: id,
    quizId: requiredString(data, 'quizId'),
    quizTitle: requiredString(data, 'quizTitle'),
    slideCount: requiredNumber(data, 'slideCount'),
    status: status(data),
    currentSlidePosition: requiredNumber(data, 'currentSlidePosition'),
    ...(optionalString(data, 'currentSlideId') === undefined ? {} : { currentSlideId: optionalString(data, 'currentSlideId') }),
    answerRevealed: data.answerRevealed === true,
    revision: requiredNumber(data, 'revision'),
  };
}

export function mapLiveControlSlide(id: string, data: DocumentData): LiveControlSlide {
  return {
    id,
    position: requiredNumber(data, 'position'),
    kind: requiredString(data, 'kind'),
    isQuestion: data.isQuestion === true,
    title: optionalString(data, 'title') ?? '',
    text: optionalString(data, 'text') ?? '',
    options: stringArray(data.options),
    ...(optionalString(data, 'correctAnswer') === undefined ? {} : { correctAnswer: optionalString(data, 'correctAnswer') }),
  };
}

export function mapPublicLiveState(id: string, data: DocumentData): PublicLiveState {
  return {
    sessionId: id,
    quizTitle: requiredString(data, 'quizTitle'),
    status: status(data),
    slidePosition: requiredNumber(data, 'slidePosition'),
    ...(optionalString(data, 'slideKind') === undefined ? {} : { slideKind: optionalString(data, 'slideKind') }),
    ...(optionalString(data, 'title') === undefined ? {} : { title: optionalString(data, 'title') }),
    ...(optionalString(data, 'text') === undefined ? {} : { text: optionalString(data, 'text') }),
    options: stringArray(data.options),
    media: publicMedia(data.media),
    answerRevealed: data.answerRevealed === true,
    ...(optionalString(data, 'revealedAnswer') === undefined ? {} : { revealedAnswer: optionalString(data, 'revealedAnswer') }),
    ...(optionalString(data, 'answerImage') === undefined ? {} : { answerImage: optionalString(data, 'answerImage') }),
    revision: requiredNumber(data, 'revision'),
  };
}
