import { describe, expect, test } from 'vitest';

import type { EditorQuiz, EditorSlide } from '../apps/web/src/features/editor/types';
import { runQuizPreflight } from '../apps/web/src/features/preflight/validation';

function slide(values: Partial<EditorSlide> = {}): EditorSlide {
  return {
    id: 'question-1', position: 1, storedKind: 'free', kind: 'free', isQuestion: true,
    roundId: 'round-1', roundTitle: 'První kolo', title: '', text: 'Syntetická otázka',
    moderatorNote: '', options: [], correctAnswer: 'Syntetická odpověď', media: [],
    presentation: { videoStart: null, videoEnd: null, audioTrigger: null, backgroundOverlay: null, answerOverlay: null, sourceQuestionNumber: null },
    backgroundImage: '', questionImage: '', answerImage: '', mediaSource: '', backgroundOverlay: null,
    clipStartSeconds: null, clipEndSeconds: null, hasLegacyData: false,
    ...values,
  };
}

function quiz(slides: readonly EditorSlide[] = [slide()]): EditorQuiz {
  return {
    id: 'synthetic-quiz', title: 'Syntetický kvíz', description: '', revision: 0,
    slideCount: slides.length, questionCount: slides.filter((item) => item.isQuestion).length,
    roundCount: 1, slides,
  };
}

const codes = (value: ReturnType<typeof runQuizPreflight>) => value.issues.map((issue) => issue.code);

describe('whole-quiz preflight', () => {
  test('valid free question is ready', () => {
    const result = runQuizPreflight(quiz());
    expect(result.status).toBe('READY');
    expect(result.blockerCount).toBe(0);
    expect(result.validAnswerCount).toBe(1);
  });

  test('valid choice has one unambiguous correct option', () => {
    const question = slide({ kind: 'question', storedKind: 'question', options: ['První', 'Druhá'], correctAnswer: 'B' });
    expect(runQuizPreflight(quiz([question])).status).toBe('READY');
  });

  test('choice without one valid correct option is blocked', () => {
    const question = slide({ kind: 'question', storedKind: 'question', options: ['Stejná', 'Stejná'], correctAnswer: 'Stejná' });
    expect(codes(runQuizPreflight(quiz([question])))).toContain('CHOICE_CORRECT_INVALID');
  });

  test('choice needs at least two non-empty options', () => {
    const question = slide({ kind: 'question', storedKind: 'question', options: ['Jediná', ''], correctAnswer: 'A' });
    expect(codes(runQuizPreflight(quiz([question])))).toContain('CHOICE_OPTIONS_TOO_FEW');
  });

  test('empty free prompt and answer are blockers', () => {
    const result = runQuizPreflight(quiz([slide({ text: '', title: '', correctAnswer: '' })]));
    expect(codes(result)).toEqual(expect.arrayContaining(['QUESTION_PROMPT_MISSING', 'ANSWER_MISSING']));
    expect(result.status).toBe('BLOCKED');
  });

  test('image requires a valid question image', () => {
    expect(codes(runQuizPreflight(quiz([slide({ kind: 'image', storedKind: 'image', questionImage: '' })])))).toContain('IMAGE_SOURCE_MISSING');
    expect(codes(runQuizPreflight(quiz([slide({ kind: 'image', storedKind: 'image', questionImage: 'not-a-url' })])))).toContain('IMAGE_SOURCE_INVALID');
  });

  test('audio requires source and both clip boundaries', () => {
    const result = runQuizPreflight(quiz([slide({ kind: 'audio', storedKind: 'audio' })]));
    expect(codes(result)).toEqual(expect.arrayContaining(['MEDIA_SOURCE_MISSING', 'CLIP_START_MISSING', 'CLIP_END_MISSING']));
  });

  test('audio rejects an end at or before start', () => {
    const question = slide({ kind: 'audio', storedKind: 'audio', mediaSource: 'abcdefghijk', clipStartSeconds: 8, clipEndSeconds: 8 });
    expect(codes(runQuizPreflight(quiz([question])))).toContain('CLIP_RANGE_INVALID');
  });

  test('video rejects invalid timing', () => {
    const question = slide({ kind: 'video', storedKind: 'video', mediaSource: 'abcdefghijk', clipStartSeconds: -1, clipEndSeconds: -2 });
    expect(codes(runQuizPreflight(quiz([question])))).toEqual(expect.arrayContaining(['CLIP_START_INVALID', 'CLIP_END_INVALID']));
  });

  test('valid PL is usable with a limited-editability warning', () => {
    const result = runQuizPreflight(quiz([slide({ kind: 'pl', storedKind: 'pl', correctAnswer: 'Pravda', hasLegacyData: true })]));
    expect(result.status).toBe('READY_WITH_WARNINGS');
    expect(codes(result)).toContain('LEGACY_LIMITED');
  });

  test('invalid PL answer is blocked', () => {
    const result = runQuizPreflight(quiz([slide({ kind: 'pl', storedKind: 'pl', correctAnswer: 'neurčeno', hasLegacyData: true })]));
    expect(result.status).toBe('BLOCKED');
    expect(codes(result)).toContain('PL_ANSWER_INVALID');
  });

  test('empty and roundless structures are classified', () => {
    const empty = runQuizPreflight({ ...quiz([]), roundCount: 0 });
    expect(codes(empty)).toContain('QUIZ_HAS_NO_ROUNDS');
    const roundless = runQuizPreflight(quiz([slide({ roundId: undefined, roundTitle: undefined })]));
    expect(codes(roundless)).toContain('ROUNDLESS_QUESTIONS');
  });

  test('online media uncertainty is a warning rather than a blocker', () => {
    const question = slide({ kind: 'video', storedKind: 'video', mediaSource: 'abcdefghijk', clipStartSeconds: 0, clipEndSeconds: 10 });
    const result = runQuizPreflight(quiz([question]));
    expect(result.status).toBe('READY_WITH_WARNINGS');
    expect(result.blockerCount).toBe(0);
    expect(codes(result)).toContain('MEDIA_ONLINE_UNVERIFIED');
  });

  test('question numbering is derived contiguously inside each round', () => {
    const result = runQuizPreflight(quiz([
      slide({ id: 'later', position: 2 }),
      slide({ id: 'earlier', position: 1 }),
    ]));
    expect(result.questionCount).toBe(2);
    expect(codes(result)).not.toContain('ROUND_QUESTION_NUMBERING_INVALID');
  });

  test('unsaved local draft blocks live without hiding other findings', () => {
    const result = runQuizPreflight(quiz(), { source: 'LOCAL_DRAFT', hasUnsavedChanges: true });
    expect(result.source).toBe('LOCAL_DRAFT');
    expect(result.status).toBe('BLOCKED');
    expect(codes(result)).toContain('UNSAVED_CHANGES');
  });

  test('result never contains private values or raw legacy payloads', () => {
    const privateValue = 'PRIVATE-SENTINEL-ANSWER';
    const result = runQuizPreflight(quiz([slide({ correctAnswer: privateValue, moderatorNote: 'PRIVATE-SENTINEL-NOTE', hasLegacyData: true })]));
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(privateValue);
    expect(serialized).not.toContain('PRIVATE-SENTINEL-NOTE');
    expect(serialized).not.toContain('legacy.raw');
  });
});
