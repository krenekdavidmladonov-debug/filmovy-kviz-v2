import { privateRead } from '../access/api';
import type { EditorQuiz } from './types';

export async function getEditorQuiz(quizId: string): Promise<EditorQuiz | null> {
  return privateRead<EditorQuiz>('editor', { quizId });
}
