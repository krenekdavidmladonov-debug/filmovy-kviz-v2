import { randomUUID } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { cert, deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, Timestamp, type Firestore, type DocumentData } from 'firebase-admin/firestore';
import { assertCloudSelection, type CloudSelection } from './cloud-contract.js';
import { MigrationSafetyError } from './errors.js';
import { object, sanitizeLibrary, slideArrayKeys } from './sanitize.js';
import type { V1LibrarySnapshot, JsonObject, JsonValue } from './types.js';
import type { PrivateTargetStore } from './target-store.js';

export interface MigrationSourceReader { readLibrary(): Promise<V1LibrarySnapshot>; close(): Promise<void> }
export interface SourceLibraryQuery { getLibrary(): Promise<readonly { id: string; data: JsonObject }[]> }
export function sourceReader(query: SourceLibraryQuery, close = async (): Promise<void> => {}): MigrationSourceReader {
  return Object.freeze({ async readLibrary() { return sanitizeLibrary({ schemaVersion: 1, collection: 'library', documents: await query.getLibrary() }); }, close });
}
export function validateCredential(value: unknown, project: string) {
  const c = value as Record<string, unknown>;
  if (!c || c.type !== 'service_account' || c.project_id !== project || typeof c.client_email !== 'string'
    || !c.client_email.endsWith('@' + project + '.iam.gserviceaccount.com') || typeof c.private_key !== 'string'
    || !c.private_key.startsWith('-----BEGIN PRIVATE KEY-----')) throw new MigrationSafetyError('Explicit project-bound service-account credential required.');
  return { projectId: project, clientEmail: c.client_email, privateKey: c.private_key };
}
async function namedApp(file: string, project: string, role: string): Promise<App> {
  try { const data: unknown = JSON.parse(await readFile(await realpath(file), 'utf8')); return initializeApp({ projectId: project, credential: cert(validateCredential(data, project)) }, 'migration-' + role + '-' + randomUUID()); }
  catch { throw new MigrationSafetyError('Cannot load project-bound credential; credential details suppressed.'); }
}
export async function openCloudSource(selection: CloudSelection, credentialFile: string, confirmReadOnly: boolean): Promise<MigrationSourceReader> {
  assertCloudSelection(selection);
  if (!confirmReadOnly) throw new MigrationSafetyError('Verify source IAM is read-only and pass --confirm-source-read-only.');
  const app = await namedApp(credentialFile, selection.sourceProject, 'source-readonly');
  const db = getFirestore(app);
  // Field mask excludes all unrelated top-level data; nested arrays are projected again locally.
  const query = db.collection('library').select('name', 'title', 'description', 'position', 'order',
    'data.settings.defaultAudioTrigger', 'data.settings.scaleTitle', 'data.settings.time_R1',
    ...slideArrayKeys, ...slideArrayKeys.map(k => 'data.' + k)).orderBy('__name__');
  return sourceReader({ async getLibrary() {
    const snapshot = await query.get(); // one query snapshot; never a mutable default app
    return snapshot.docs.map(d => ({ id: d.id, data: d.data() }));
  } }, () => deleteApp(app));
}
function portable(v: unknown): JsonValue {
  if (v instanceof Timestamp) return { __migrationTimestamp: v.toDate().toISOString() };
  if (v === null || typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))) return v;
  if (Array.isArray(v)) return v.map(portable);
  if (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, portable(x)]));
  throw new MigrationSafetyError('Unsupported target data; target cannot be compared safely.');
}
function firestoreData(v: JsonValue): unknown {
  if (Array.isArray(v)) return v.map(firestoreData);
  if (v && typeof v === 'object') {
    if (Object.keys(v).length === 1 && typeof v.__migrationTimestamp === 'string') return Timestamp.fromDate(new Date(v.__migrationTimestamp));
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, firestoreData(x)]));
  }
  return v;
}
// Kept separate from the source adapter; injected only by cloud factory or guarded emulator test.
export function targetStore(db: Firestore): PrivateTargetStore {
  return {
    async listQuizIds() {
      const [refs, journals] = await Promise.all([db.collection('quizzes').listDocuments(), db.collection('migrationV1Imports').listDocuments()]);
      return [...new Set([...refs, ...journals].map(r => r.id))].sort();
    },
    async readQuiz(id) {
      const root = db.collection('quizzes').doc(id);
      const [snapshot, slides, roundRefs, journal, complete] = await Promise.all([root.get(), root.collection('slides').get(),
        root.collection('rounds').listDocuments(), db.doc('migrationV1Imports/' + id).get(), db.doc('migrationV1Imports/' + id + '/state/complete').get()]);
      const rounds = [];
      for (const ref of roundRefs) {
        const [r, questions] = await Promise.all([ref.get(), ref.collection('questions').get()]);
        if (!r.exists) throw new MigrationSafetyError('Orphan target round; comparison blocked.');
        rounds.push({ id: r.id, quizId: id, data: object(portable(r.data())),
          questions: questions.docs.map(q => ({ id: q.id, quizId: id, roundId: r.id, data: object(portable(q.data())) })) });
      }
      return { exists: snapshot.exists, pending: journal.exists && !complete.exists,
        quiz: { id, data: snapshot.exists ? object(portable(snapshot.data())) : {},
          slides: slides.docs.map(s => ({ id: s.id, quizId: id, data: object(portable(s.data())) })), rounds } };
    },
    async createBatch(docs) {
      const batch = db.batch();
      for (const d of docs) {
        if (!/^quizzes\/[A-Za-z0-9_-]+(?:\/slides\/[A-Za-z0-9_-]+|\/rounds\/[A-Za-z0-9_-]+(?:\/questions\/[A-Za-z0-9_-]+)?)?$/u.test(d.path)
          && !/^migrationV1Imports\/[A-Za-z0-9_-]+(?:\/state\/complete)?$/u.test(d.path)) throw new MigrationSafetyError('Write outside private migration paths.');
        batch.create(db.doc(d.path), firestoreData(d.data) as DocumentData);
      }
      await batch.commit();
    },
  };
}
export async function openCloudTarget(selection: CloudSelection, credentialFile: string) {
  assertCloudSelection(selection);
  const app = await namedApp(credentialFile, selection.targetProject, 'target-staging');
  return { store: targetStore(getFirestore(app)), close: () => deleteApp(app) };
}
