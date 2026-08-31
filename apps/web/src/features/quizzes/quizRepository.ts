import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
} from 'firebase/firestore';

import { getFirebaseFirestore } from '../../services/firebase/firestore';
import { mapQuizQuestion, mapQuizRound, mapQuizSummary } from './quizMappers';
import type { QuizDetail, QuizRound, QuizSummary } from './types';

export async function listQuizzes(): Promise<readonly QuizSummary[]> {
  const db = getFirebaseFirestore();
  const snapshot = await getDocs(query(collection(db, 'quizzes'), orderBy('updatedAt', 'desc')));
  return snapshot.docs.map((quizDocument) => mapQuizSummary(quizDocument.id, quizDocument.data()));
}

export async function getQuizDetail(quizId: string): Promise<QuizDetail | null> {
  const db = getFirebaseFirestore();
  const quizRef = doc(db, 'quizzes', quizId);
  const quizSnapshot = await getDoc(quizRef);

  if (!quizSnapshot.exists()) {
    return null;
  }

  const roundSnapshots = await getDocs(query(collection(quizRef, 'rounds'), orderBy('position')));
  const rounds: QuizRound[] = await Promise.all(roundSnapshots.docs.map(async (roundDocument) => {
    const roundData = roundDocument.data();
    const questionSnapshots = await getDocs(
      query(collection(roundDocument.ref, 'questions'), orderBy('position')),
    );

    return mapQuizRound(
      roundDocument.id,
      roundData,
      questionSnapshots.docs.map((questionDocument) => (
        mapQuizQuestion(questionDocument.id, questionDocument.data())
      )),
    );
  }));

  return { ...mapQuizSummary(quizSnapshot.id, quizSnapshot.data()), rounds };
}
