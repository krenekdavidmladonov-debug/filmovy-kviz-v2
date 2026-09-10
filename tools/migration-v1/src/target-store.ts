import { MigrationSafetyError } from './errors.js';
import { createInventory, type TargetEntry } from './cloud-contract.js';
import { contentFingerprint, canonical } from './fingerprint.js';
import { assertId, object } from './sanitize.js';
import type { JsonObject, V2QuizDocument } from './types.js';

export interface PrivateDocument { path: string; data: JsonObject }
export interface PrivateTargetStore {
  listQuizIds(): Promise<string[]>; // includes missing parent documents and import journals
  readQuiz(id: string): Promise<{ quiz: V2QuizDocument; exists: boolean; pending: boolean }>;
  createBatch(documents: readonly PrivateDocument[]): Promise<void>;
}
export function quizDocuments(q: V2QuizDocument): PrivateDocument[] {
  assertId(q.id); const prefix = 'quizzes/' + q.id;
  const docs: PrivateDocument[] = [{ path: prefix, data: q.data }];
  for (const s of q.slides) { assertId(s.id); docs.push({ path: prefix + '/slides/' + s.id, data: s.data }); }
  for (const r of q.rounds) { assertId(r.id); docs.push({ path: prefix + '/rounds/' + r.id, data: r.data });
    for (const question of r.questions) { assertId(question.id); docs.push({ path: prefix + '/rounds/' + r.id + '/questions/' + question.id, data: question.data }); }
  }
  if (new Set(docs.map(d => d.path)).size !== docs.length) throw new MigrationSafetyError('Duplicate target document path.');
  return docs;
}
export async function inspectTarget(store: PrivateTargetStore, project: string) {
  const entries: TargetEntry[] = [];
  for (const id of await store.listQuizIds()) {
    assertId(id); const { quiz, exists, pending } = await store.readQuiz(id);
    let provenance: JsonObject | null = null;
    if (quiz.data.legacy && typeof quiz.data.legacy === 'object' && !Array.isArray(quiz.data.legacy)) {
      const p = object(quiz.data.legacy); provenance = {};
      for (const key of ['source', 'sourceProject', 'sourceCollection', 'sourceId', 'transformVersion']) {
        const v = p[key]; if (typeof v === 'string' || typeof v === 'number') provenance[key] = v;
      }
    }
    entries.push({ id, title: typeof quiz.data.title === 'string' ? quiz.data.title : '', provenance,
      contentFingerprint: exists ? contentFingerprint(quiz) : null, rounds: quiz.rounds.length,
      questions: quiz.rounds.reduce((n, r) => n + r.questions.length, 0), incomplete: !exists || pending });
  }
  return createInventory(entries, project);
}
function batches(docs: readonly PrivateDocument[]): PrivateDocument[][] {
  const result: PrivateDocument[][] = []; let batch: PrivateDocument[] = []; let bytes = 0;
  for (const doc of docs) {
    const size = Buffer.byteLength(canonical(doc));
    if (size > 800_000) throw new MigrationSafetyError('Document exceeds conservative Firestore size bound.');
    if (batch.length >= 400 || bytes + size > 6_000_000) { result.push(batch); batch = []; bytes = 0; }
    batch.push(doc); bytes += size;
  }
  if (batch.length) result.push(batch);
  return result;
}
export async function createOnlyQuiz(store: PrivateTargetStore, quiz: V2QuizDocument): Promise<void> {
  const docs = quizDocuments(quiz);
  const before = await store.readQuiz(quiz.id);
  if (before.exists || before.pending || before.quiz.slides.length || before.quiz.rounds.length) {
    throw new MigrationSafetyError('Target appeared or contains an incomplete import; no overwrite.');
  }
  const groups = batches(docs);
  if (groups.length === 1) { await store.createBatch(docs); return; }
  // A private immutable intent plus completion marker; neither is a library root.
  // Interrupted imports are deliberately BLOCKED for separate operator recovery.
  const journal = 'migrationV1Imports/' + quiz.id;
  await store.createBatch([{ path: journal, data: { state: 'staging', contentFingerprint: contentFingerprint(quiz) } }]);
  for (const group of batches(docs.slice(1))) await store.createBatch(group);
  const read = await store.readQuiz(quiz.id);
  if (read.exists || contentFingerprint({ ...read.quiz, data: quiz.data }) !== contentFingerprint(quiz)) {
    throw new MigrationSafetyError('Staged private children did not match; quiz remains unpublished.');
  }
  await store.createBatch([docs[0]!, { path: journal + '/state/complete', data: { state: 'complete' } }]);
}
