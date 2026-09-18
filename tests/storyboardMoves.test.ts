import { beforeEach, expect, it, vi } from 'vitest';
import type { EditorQuiz } from '../apps/web/src/features/editor/types';
import { moveStoryboardQuestion } from '../apps/web/src/features/editor/storyboardMoves';
import { moveQuizQuestionToRound, reorderQuizQuestion } from '../apps/web/src/features/editor/editorApi';
vi.mock('../apps/web/src/features/editor/editorApi', () => ({ moveQuizQuestionToRound: vi.fn(), reorderQuizQuestion: vi.fn() }));
const quiz: EditorQuiz = { id: 'quiz', title: 'Quiz', description: '', slideCount: 4, questionCount: 4, roundCount: 2, revision: 7, slides: ['a', 'b', 'c', 'd'].map((id, i) => ({ id, isQuestion: true, roundId: i < 2 ? 'r1' : 'r2', position: i + 1, kind: 'free', storedKind: 'free', text: id, title: '', options: [], correctAnswer: '', moderatorNote: '', media: [], hasLegacyData: false, presentation: { videoStart: null, videoEnd: null, audioTrigger: null, backgroundOverlay: null, answerOverlay: null, sourceQuestionNumber: null }, backgroundImage: '', questionImage: '', answerImage: '', mediaSource: '', backgroundOverlay: null, clipStartSeconds: null, clipEndSeconds: null })) };
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(moveQuizQuestionToRound).mockImplementation((_quiz, revision) => Promise.resolve({ quizId: 'quiz', revision: revision + 1, slideCount: 4, questionCount: 4, roundCount: 2 }));
  vi.mocked(reorderQuizQuestion).mockImplementation((_quiz, revision) => Promise.resolve({ quizId: 'quiz', revision: revision + 1, slideCount: 4, questionCount: 4, roundCount: 2 }));
});
it('moves across rounds and positions with successive acknowledged revisions', async () => {
  await moveStoryboardQuestion(quiz, 'a', 'r2', 'c');
  expect(moveQuizQuestionToRound).toHaveBeenCalledWith('quiz', 7, 'a', 'r2');
  expect(vi.mocked(reorderQuizQuestion).mock.calls).toEqual([['quiz', 8, 'a', -1], ['quiz', 9, 'a', -1]]);
});
it('moves down within a round and does not write for unchanged position', async () => {
  await moveStoryboardQuestion(quiz, 'a', 'r1', 'b'); expect(reorderQuizQuestion).not.toHaveBeenCalled();
  await moveStoryboardQuestion(quiz, 'a', 'r1'); expect(reorderQuizQuestion).toHaveBeenCalledWith('quiz', 7, 'a', 1);
});
it('stops at the first failed revision and rejects an unknown target before writing', async () => {
  await expect(moveStoryboardQuestion(quiz, 'a', 'r2', 'missing')).rejects.toThrow();
  expect(moveQuizQuestionToRound).not.toHaveBeenCalled();
  vi.mocked(reorderQuizQuestion).mockRejectedValueOnce(new Error('revision conflict'));
  await expect(moveStoryboardQuestion(quiz, 'a', 'r2', 'c')).rejects.toThrow('revision conflict');
  expect(reorderQuizQuestion).toHaveBeenCalledTimes(1);
});
