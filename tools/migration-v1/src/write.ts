import { deleteApp, initializeApp } from 'firebase-admin/app';
import {
  getFirestore,
  Timestamp,
  type DocumentData,
  type Firestore,
  type WriteBatch,
} from 'firebase-admin/firestore';

import { MigrationSafetyError } from './errors.js';
import type { JsonValue, V2QuizDocument } from './types.js';

interface SafeEmulatorTarget {
  readonly baseUrl: string;
  readonly projectId: string;
}

export function assertSafeEmulatorEnvironment(environment: NodeJS.ProcessEnv = process.env): SafeEmulatorTarget {
  const host = environment.FIRESTORE_EMULATOR_HOST;
  const projectId = environment.GCLOUD_PROJECT ?? environment.GOOGLE_CLOUD_PROJECT ?? environment.FIREBASE_PROJECT_ID;
  if (host === undefined || host.trim() === '') {
    throw new MigrationSafetyError('Refusing to write: FIRESTORE_EMULATOR_HOST is not set.');
  }
  const match = /^(?:localhost|127\.0\.0\.1|\[::1\]):([1-9]\d{0,4})$/u.exec(host);
  const port = match === null ? Number.NaN : Number(match[1]);
  if (!Number.isInteger(port) || port > 65_535) {
    throw new MigrationSafetyError('Refusing to write: Firestore Emulator must use localhost with an explicit port.');
  }
  if (projectId === undefined || !projectId.startsWith('demo-')) {
    throw new MigrationSafetyError('Refusing to write: Firebase project ID must start with demo-.');
  }
  return { baseUrl: `http://${host}`, projectId };
}

async function assertEmptyMigrationTarget(db: Firestore): Promise<void> {
  const snapshots = await Promise.all([
    db.collection('quizzes').limit(1).get(),
    db.collectionGroup('slides').limit(1).get(),
    db.collectionGroup('rounds').limit(1).get(),
    db.collectionGroup('questions').limit(1).get(),
  ]);
  if (snapshots.some((snapshot) => !snapshot.empty)) {
    throw new MigrationSafetyError(
      'Refusing to write: the demo emulator already contains quiz migration data; use a fresh dedicated emulator.',
    );
  }
}

function toFirestoreData(value: JsonValue): unknown {
  if (Array.isArray(value)) return value.map(toFirestoreData);
  if (value !== null && typeof value === 'object') {
    if (Object.keys(value).length === 1 && typeof value.__migrationTimestamp === 'string') {
      return Timestamp.fromDate(new Date(value.__migrationTimestamp));
    }
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, toFirestoreData(nested)]));
  }
  return value;
}

function quizDocumentCount(quiz: V2QuizDocument): number {
  return 1 + quiz.slides.length + quiz.rounds.reduce(
      (roundTotal, round) => roundTotal + 1 + round.questions.length,
      0,
  );
}

function addQuizWrites(db: Firestore, batch: WriteBatch, quiz: V2QuizDocument): void {
  const quizRef = db.collection('quizzes').doc(quiz.id);
  batch.set(quizRef, toFirestoreData(quiz.data) as DocumentData);
  for (const slide of quiz.slides) {
    batch.set(
      quizRef.collection('slides').doc(slide.id),
      toFirestoreData(slide.data) as DocumentData,
    );
  }
  for (const round of quiz.rounds) {
    const roundRef = quizRef.collection('rounds').doc(round.id);
    batch.set(roundRef, toFirestoreData(round.data) as DocumentData);
    for (const question of round.questions) {
      batch.set(
        roundRef.collection('questions').doc(question.id),
        toFirestoreData(question.data) as DocumentData,
      );
    }
  }
}

export async function writeToFirestoreEmulator(
  quizzes: readonly V2QuizDocument[],
): Promise<number> {
  const target = assertSafeEmulatorEnvironment(process.env);
  const counts = quizzes.map(quizDocumentCount);
  for (const [index, count] of counts.entries()) {
    if (count > 500) {
      throw new MigrationSafetyError(
        `Refusing quiz ${quizzes[index]!.id}: its ${count} documents exceed the atomic 500-document limit.`,
      );
    }
  }

  const app = initializeApp({ projectId: target.projectId }, `migration-v1-${Date.now()}`);
  try {
    const db = getFirestore(app);
    await assertEmptyMigrationTarget(db);
    for (const quiz of quizzes) {
      const batch = db.batch();
      addQuizWrites(db, batch, quiz);
      await batch.commit();
    }
  } finally {
    await deleteApp(app);
  }
  return counts.reduce((total, count) => total + count, 0);
}
