import type { DocumentData } from 'firebase/firestore';

import {
  editableSlideKinds,
  type EditableSlideKind,
  type EditorMedia,
  type EditorMediaKind,
  type EditorMediaRole,
  type EditorPresentation,
  type EditorQuiz,
  type EditorSlide,
} from './types';

const kindSet = new Set<string>(editableSlideKinds);
const mediaKinds = new Set<string>(['image', 'audio', 'video', 'unknown']);
const mediaRoles = new Set<string>(['prompt', 'answer', 'background', 'unknown']);

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && !Array.isArray(value) && typeof value === 'object'
    ? value as Record<string, unknown>
    : undefined;
}

function requiredString(data: DocumentData, field: string): string {
  if (typeof data[field] !== 'string') throw new Error(`Invalid editor field: ${field}`);
  return data[field];
}

function requiredCount(data: DocumentData, field: string): number {
  const value: unknown = data[field];
  if (!Number.isInteger(value) || (value as number) < 0) throw new Error(`Invalid editor field: ${field}`);
  return value as number;
}

function optionalText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === undefined || value === null) return '';
  return JSON.stringify(value);
}

function nullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function mapPresentation(value: unknown): EditorPresentation {
  const data = object(value) ?? {};
  return {
    videoStart: nullableNumber(data.videoStart),
    videoEnd: nullableNumber(data.videoEnd),
    audioTrigger: nullableNumber(data.audioTrigger),
    backgroundOverlay: nullableNumber(data.backgroundOverlay),
    answerOverlay: nullableNumber(data.answerOverlay),
    sourceQuestionNumber: typeof data.sourceQuestionNumber === 'string' ? data.sourceQuestionNumber : null,
  };
}

function mediaSource(data: Record<string, unknown>): string {
  for (const field of ['value', 'source', 'url']) {
    if (typeof data[field] === 'string') return data[field];
  }
  return '';
}

function mapMedia(value: unknown): readonly EditorMedia[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry, sourceIndex) => {
    const data = object(entry);
    if (data === undefined) return [];
    const source = mediaSource(data);
    if (source === '') return [];
    const storedRole = typeof data.role === 'string' ? data.role : 'unknown';
    const storedKind = typeof data.kind === 'string' ? data.kind : 'unknown';
    return [{
      sourceIndex,
      role: (mediaRoles.has(storedRole) ? storedRole : 'unknown') as EditorMediaRole,
      kind: (mediaKinds.has(storedKind) ? storedKind : 'unknown') as EditorMediaKind,
      source,
    }];
  });
}

export function mapEditorSlide(id: string, data: DocumentData): EditorSlide {
  const storedKind = requiredString(data, 'kind');
  const position = requiredCount(data, 'position');
  if (position < 1) throw new Error('Invalid editor field: position');
  return {
    id,
    position,
    storedKind,
    kind: (kindSet.has(storedKind) ? storedKind : 'legacy') as EditableSlideKind,
    isQuestion: data.isQuestion === true,
    ...(typeof data.roundId === 'string' ? { roundId: data.roundId } : {}),
    title: optionalText(data.title),
    text: optionalText(data.text),
    moderatorNote: optionalText(data.moderatorNote),
    options: Array.isArray(data.options) ? data.options.map(optionalText) : [],
    correctAnswer: optionalText(data.correctAnswer),
    media: mapMedia(data.media),
    presentation: mapPresentation(data.presentation),
    hasLegacyData: object(data.legacy) !== undefined || !kindSet.has(storedKind),
  };
}

export function mapEditorQuiz(id: string, data: DocumentData, slides: readonly EditorSlide[]): EditorQuiz {
  const revision = data.revision === undefined ? 0 : requiredCount(data, 'revision');
  const ordered = [...slides].sort((left, right) => left.position - right.position);
  ordered.forEach((slide, index) => {
    if (slide.position !== index + 1) throw new Error('Pořadí slidů není souvislé.');
  });
  const slideCount = requiredCount(data, 'slideCount');
  if (slideCount !== ordered.length) throw new Error('Počet slidů neodpovídá uloženému streamu.');
  return {
    id,
    title: requiredString(data, 'title'),
    description: requiredString(data, 'description'),
    revision,
    slideCount,
    questionCount: requiredCount(data, 'questionCount'),
    roundCount: requiredCount(data, 'roundCount'),
    slides: ordered,
  };
}
