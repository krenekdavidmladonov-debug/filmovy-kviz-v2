import { moveQuizQuestionToRound, reorderQuizQuestion } from './editorApi';
import type { EditorQuiz } from './types';

/** Existing revision-checked operations; abort on the first unacknowledged write. */
export async function moveStoryboardQuestion(quiz: EditorQuiz, id: string, targetRoundId: string | undefined, beforeId?: string) {
  const source = quiz.slides.find(slide => slide.id === id && slide.isQuestion);
  if (!source || beforeId === id) return;
  const target = quiz.slides.filter(slide => slide.isQuestion && slide.roundId === targetRoundId && slide.id !== id).sort((a, b) => a.position - b.position);
  const destination = beforeId === undefined ? target.length : target.findIndex(slide => slide.id === beforeId);
  if (destination < 0) throw new Error('Cílová otázka již není v tomto kole. Obnovte editor.');
  let revision = quiz.revision;
  let currentIndex: number;
  if (source.roundId !== targetRoundId) {
    if (!targetRoundId) throw new Error('Otázku lze přesunout pouze do existujícího kola.');
    const result = await moveQuizQuestionToRound(quiz.id, revision, id, targetRoundId);
    revision = result.revision; currentIndex = target.length;
  } else {
    currentIndex = quiz.slides.filter(slide => slide.isQuestion && slide.roundId === targetRoundId).sort((a, b) => a.position - b.position).findIndex(slide => slide.id === id);
  }
  while (currentIndex !== destination) {
    const direction = currentIndex < destination ? 1 : -1;
    const result = await reorderQuizQuestion(quiz.id, revision, id, direction);
    revision = result.revision; currentIndex += direction;
  }
}
