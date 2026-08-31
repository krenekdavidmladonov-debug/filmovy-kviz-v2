import { Timestamp } from 'firebase/firestore';
import { describe, expect, test } from 'vitest';

import { mapQuizQuestion, mapQuizSummary } from '../apps/web/src/features/quizzes/quizMappers';

const validQuizData = {
  title: 'Testovací kvíz',
  description: 'Popis',
  status: 'ready',
  createdAt: Timestamp.fromDate(new Date('2026-01-01T10:00:00.000Z')),
  updatedAt: Timestamp.fromDate(new Date('2026-02-01T11:00:00.000Z')),
  createdBy: 'seed',
  updatedBy: 'seed',
  roundCount: 2,
  questionCount: 10,
};

describe('quiz Firestore mapping', () => {
  test('maps a valid quiz summary', () => {
    const quiz = mapQuizSummary('quiz-1', validQuizData);

    expect(quiz).toMatchObject({
      id: 'quiz-1',
      title: 'Testovací kvíz',
      status: 'ready',
      roundCount: 2,
      questionCount: 10,
    });
    expect(quiz.updatedAt.toISOString()).toBe('2026-02-01T11:00:00.000Z');
  });

  test('rejects an unsupported quiz status', () => {
    expect(() => mapQuizSummary('quiz-1', { ...validQuizData, status: 'published' }))
      .toThrow('Invalid Firestore field: status');
  });

  test('does not expose the correct answer in the question view model', () => {
    const question = mapQuizQuestion('question-1', {
      type: 'text',
      prompt: 'Soukromá otázka',
      correctAnswer: 'Tajná odpověď',
      position: 1,
    });

    expect(question).toEqual({
      id: 'question-1',
      type: 'text',
      prompt: 'Soukromá otázka',
      position: 1,
    });
    expect('correctAnswer' in question).toBe(false);
  });
});
