import { expect, it, vi } from 'vitest';
import { overlayEntries, saveEditorEntries, type EditorEntries } from '../apps/web/src/features/editor/workingCopy';
import type { EditorQuiz, EditorSlide } from '../apps/web/src/features/editor/types';

const slide = (id: string): EditorSlide => ({ id, position: id === 'a' ? 1 : 2, kind: 'free', storedKind: 'free', isQuestion: true,
  text: id, title: '', options: [], correctAnswer: 'Answer', moderatorNote: '', media: [], hasLegacyData: false,
  presentation: { videoStart: null, videoEnd: null, audioTrigger: null, backgroundOverlay: null, answerOverlay: null, sourceQuestionNumber: null },
  backgroundImage: '', questionImage: '', answerImage: '', mediaSource: '', backgroundOverlay: null, clipStartSeconds: null, clipEndSeconds: null });
const base: EditorQuiz = { id: 'quiz', title: 'Quiz', description: '', revision: 7, slides: [slide('a'), slide('b')], slideCount: 2, questionCount: 2, roundCount: 0 };
const entries: EditorEntries = Object.fromEntries(base.slides.map(s => ['slide:' + s.id, { draft: { ...s, text: s.text + ' changed' }, dirtySlide: true, dirtyRound: false, roundTitle: '', pendingCreate: null }]));
const result = (revision: number, selectedSlideId?: string) => ({ quizId: 'quiz', revision, slideCount: 2, questionCount: 2, roundCount: 0, selectedSlideId });
const operations = () => ({ updateSlide: vi.fn((_id: string, revision: number, s: EditorSlide) => Promise.resolve(result(revision + 1, s.id))),
  createSlide: vi.fn(() => Promise.resolve(result(8, 'created'))), updateRound: vi.fn(() => Promise.resolve(result(9))), updateMetadata: vi.fn(() => Promise.resolve(result(10))) });

it('overlays all pending content without modifying the saved baseline', () => {
  expect(overlayEntries(base, entries).slides.map(s => s.text)).toEqual(['a changed', 'b changed']);
  expect(base.slides.map(s => s.text)).toEqual(['a', 'b']);
});
it('saves multiple items using each acknowledged revision', async () => {
  const ops = operations(), saved = await saveEditorEntries(base, entries, null, ops);
  expect(ops.updateSlide.mock.calls.map(c => c[1])).toEqual([7, 8]);
  expect(saved.quiz.revision).toBe(9); expect(saved.remaining).toEqual({}); expect(saved.error).toBeNull();
});
it('retains only unacknowledged work after a partial failure and resumes without resending earlier edits', async () => {
  const ops = operations(); ops.updateSlide.mockRejectedValueOnce(new Error('offline'));
  const failedFirst = await saveEditorEntries(base, entries, null, ops);
  expect(failedFirst.remaining).toEqual(entries); expect(failedFirst.quiz.revision).toBe(7);
  ops.updateSlide.mockReset().mockResolvedValueOnce(result(8, 'a')).mockRejectedValueOnce(new Error('offline'));
  const partial = await saveEditorEntries(base, entries, null, ops);
  expect(Object.keys(partial.remaining)).toEqual(['slide:b']); expect(partial.quiz.slides[0]?.text).toBe('a changed');
  expect(partial.quiz.slides[1]?.text).toBe('b'); expect(partial.quiz.revision).toBe(8);
  ops.updateSlide.mockReset().mockResolvedValueOnce(result(9, 'b'));
  const retry = await saveEditorEntries(partial.quiz, partial.remaining, null, ops);
  expect(ops.updateSlide.mock.calls.map(c => [c[1], c[2].id])).toEqual([[8, 'b']]); expect(retry.remaining).toEqual({});
});
it('keeps the expected revision after a lost response, so the server can reject unsafe replay', async () => {
  const ops = operations(); ops.updateSlide.mockRejectedValue(new Error('response lost'));
  const failed = await saveEditorEntries(base, entries, null, ops);
  expect(failed.quiz).toBe(base); expect(failed.acknowledged).toBe(0); expect(failed.remaining).toEqual(entries);
});
it('preserves pending metadata after slide writes succeed and metadata fails', async () => {
  const ops = operations(); ops.updateMetadata.mockRejectedValue(new Error('conflict'));
  const metadata = { title: 'Changed', description: '', appearance: { backgroundImage: '', backgroundOverlay: 0, imageLayout: 'split' as const } };
  const saved = await saveEditorEntries(base, entries, metadata, ops);
  expect(saved.remaining).toEqual({}); expect(saved.metadataPending).toBe(true); expect(saved.quiz.title).toBe('Quiz'); expect(saved.quiz.revision).toBe(9);
});
it('does not recreate an acknowledged new item when a later metadata write fails', async () => {
  const ops = operations(); ops.updateMetadata.mockRejectedValue(new Error('offline'));
  const metadata = { title: 'Changed', description: '', appearance: { backgroundImage: '', backgroundOverlay: 0, imageLayout: 'split' as const } };
  const saved = await saveEditorEntries(base, { draft: { draft: slide('new'), dirtySlide: true, dirtyRound: false, roundTitle: '', pendingCreate: { position: 3, semanticKey: 'draft' } } }, metadata, ops);
  expect(saved.created).toEqual({ draft: 'created' }); expect(saved.remaining).toEqual({}); expect(saved.quiz.slides.some(s => s.id === 'created')).toBe(true);
});
