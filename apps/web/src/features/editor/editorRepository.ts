import { collection, doc, getDocFromServer, getDocsFromServer, orderBy, query, type DocumentData } from 'firebase/firestore';

import { getFirebaseFirestore } from '../../services/firebase/firestore';
import { mapEditorQuiz, mapEditorSlide } from './editorMappers';
import type { EditorQuiz } from './types';

function revision(data: DocumentData): number {
  const value: unknown = data.revision;
  if (value === undefined) return 0;
  if (!Number.isInteger(value) || (value as number) < 0) throw new Error('Revize kvízu není platná.');
  return value as number;
}

export async function getEditorQuiz(quizId: string): Promise<EditorQuiz | null> {
  const db = getFirebaseFirestore();
  const quizRef = doc(db, 'quizzes', quizId);
  const slidesQuery = query(collection(quizRef, 'slides'), orderBy('position'));
  const roundsQuery = query(collection(quizRef, 'rounds'), orderBy('position'));
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const before = await getDocFromServer(quizRef);
    if (!before.exists()) return null;
    const beforeRevision = revision(before.data());
    const [slideSnapshot, roundSnapshot] = await Promise.all([
      getDocsFromServer(slidesQuery),
      getDocsFromServer(roundsQuery),
    ]);
    const after = await getDocFromServer(quizRef);
    if (!after.exists()) return null;
    const afterRevision = revision(after.data());
    if (beforeRevision !== afterRevision) continue;
    const roundTitles = new Map<string, string>();
    for (const round of roundSnapshot.docs) {
      const roundTitle = round.get('title') as unknown;
      if (typeof roundTitle === 'string') roundTitles.set(round.id, roundTitle);
    }
    const slides = slideSnapshot.docs.map((slide) => {
      const mapped = mapEditorSlide(slide.id, slide.data());
      const storedRoundTitle = mapped.roundId === undefined ? undefined : roundTitles.get(mapped.roundId);
      return mapped.roundTitle !== undefined || storedRoundTitle === undefined
        ? mapped
        : { ...mapped, roundTitle: storedRoundTitle };
    });
    return mapEditorQuiz(after.id, after.data(), slides);
  }
  throw new Error('Kvíz se právě mění v jiném okně. Zkuste načtení zopakovat.');
}
