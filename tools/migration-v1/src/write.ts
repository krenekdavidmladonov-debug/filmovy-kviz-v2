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
  if (host.includes('/') || host.includes('://')) {
    throw new MigrationSafetyError('Refusing to write: FIRESTORE_EMULATOR_HOST must be a bare local host and port.');
  }
  let parsed: URL;
  try {
    parsed = new URL(`http://${host}`);
  } catch {
    throw new MigrationSafetyError('Refusing to write: FIRESTORE_EMULATOR_HOST is invalid.');
  }
  if (!['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname) || parsed.port === '') {
    throw new MigrationSafetyError('Refusing to write: Firestore Emulator must use localhost with an explicit port.');
  }
  if (projectId === undefined || !projectId.startsWith('demo-')) {
    throw new MigrationSafetyError('Refusing to write: Firebase project ID must start with demo-.');
  }
  return { baseUrl: parsed.origin, projectId };
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

function documentCount(quizzes: readonly V2QuizDocument[]): number {
  return quizzes.reduce(
    (total, quiz) => total + 1 + quiz.rounds.reduce(
      (roundTotal, round) => roundTotal + 1 + round.questions.length,
      0,
    ),
    0,
  );
}

function addQuizWrites(db: Firestore, batch: WriteBatch, quiz: V2QuizDocument): void {
  const quizRef = db.collection('quizzes').doc(quiz.id);
  batch.set(quizRef, toFirestoreData(quiz.data) as DocumentData);
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
  const count = documentCount(quizzes);
  if (count > 500) {
    throw new MigrationSafetyError(
      `Refusing a non-atomic write of ${count} documents; the safe framework limit is 500 documents per run.`,
    );
  }

  const app = initializeApp({ projectId: target.projectId }, `migration-v1-${Date.now()}`);
  try {
    const db = getFirestore(app);
    const batch = db.batch();
    for (const quiz of quizzes) addQuizWrites(db, batch, quiz);
    await batch.commit();
  } finally {
    await deleteApp(app);
  }
  return count;
}
