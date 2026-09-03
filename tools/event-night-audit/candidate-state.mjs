import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';

const requireFromFunctions = createRequire(path.resolve('functions/package.json'));
const { deleteApp, initializeApp } = requireFromFunctions('firebase-admin/app');
const { getFirestore } = requireFromFunctions('firebase-admin/firestore');

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    if (typeof value.toMillis === 'function') return { __timestampMillis: value.toMillis() };
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

async function collectionState(reference, orderByPosition = false) {
  const snapshot = await (orderByPosition ? reference.orderBy('position').get() : reference.get());
  return snapshot.docs.map((document) => ({ id: document.id, data: canonical(document.data()) }));
}

export async function withAuditFirestore(projectId, callback) {
  const app = initializeApp({ projectId }, `event-night-audit-${Date.now()}-${Math.random()}`);
  try {
    return await callback(getFirestore(app));
  } finally {
    await deleteApp(app);
  }
}

export async function findCandidateQuiz(db) {
  const quizzes = await db.collection('quizzes').get();
  const candidates = quizzes.docs.filter((document) => (
    document.get('roundCount') === 5
    && document.get('questionCount') === 50
  ));
  if (candidates.length !== 1) {
    throw new Error(`Expected exactly one 5-round/50-question candidate; found ${candidates.length}.`);
  }
  return candidates[0];
}

export async function loadCandidateState(db, quizId) {
  const quizReference = db.collection('quizzes').doc(quizId);
  const quiz = await quizReference.get();
  if (!quiz.exists) throw new Error('Candidate quiz is missing from the isolated audit emulator.');
  const [slides, rounds] = await Promise.all([
    collectionState(quizReference.collection('slides'), true),
    collectionState(quizReference.collection('rounds'), true),
  ]);
  const questions = [];
  for (const round of rounds) {
    questions.push({
      roundId: round.id,
      documents: await collectionState(quizReference.collection('rounds').doc(round.id).collection('questions'), true),
    });
  }
  return { quiz: { id: quiz.id, data: canonical(quiz.data()) }, slides, rounds, questions };
}

export function stateFingerprint(state) {
  return createHash('sha256').update(JSON.stringify(canonical(state))).digest('hex');
}

export async function publicSessionCount(db) {
  return (await db.collection('publicSessions').get()).size;
}
