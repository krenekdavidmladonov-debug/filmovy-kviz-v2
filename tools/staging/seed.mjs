import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { initializeApp as clientApp, deleteApp as deleteClientApp } from 'firebase/app';
import { getAuth as clientAuth, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { assertStagingProject, STAGING_PROJECT } from './guard.mjs';
import { stagingClient, stagingWebConfig } from './cloud.mjs';

process.chdir(fileURLToPath(new URL('../../', import.meta.url)));
assertStagingProject(process.argv[2]);
if (process.argv.length !== 3) throw new Error('Explicit staging project argument required.');
for (const key of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST', 'GOOGLE_APPLICATION_CREDENTIALS']) {
  if (process.env[key]) throw new Error(`Remove ${key}; staging seed uses only operator CLI OAuth.`);
}
const manifestPath = '.local-data/staging/seed.json';
if (existsSync(manifestPath)) throw new Error('Seed already started. Do not overwrite or duplicate it; inspect local manifest first.');
mkdirSync('.local-data/staging', { recursive: true });
const require = createRequire(import.meta.url);
const adminRequire = createRequire(new URL('../../functions/package.json', import.meta.url));
const { initializeApp, deleteApp } = adminRequire('firebase-admin/app');
const { getAuth } = adminRequire('firebase-admin/auth');
const cliAuth = require('firebase-tools/lib/auth');
const account = cliAuth.getGlobalDefaultAccount();
if (!account) throw new Error('Firebase login required.');
const app = initializeApp({ projectId: STAGING_PROJECT, credential: { async getAccessToken() {
  const token = await cliAuth.getAccessToken(account.tokens.refresh_token, ['https://www.googleapis.com/auth/cloud-platform']);
  return { access_token: token.access_token, expires_in: 3600 };
} } }, 'staging-seed');
const firestore = await stagingClient('https://firestore.googleapis.com', 'v1');
const database = `projects/${STAGING_PROJECT}/databases/(default)`;
function value(data) {
  if (data === null) return { nullValue: null };
  if (data instanceof Date) return { timestampValue: data.toISOString() };
  if (Array.isArray(data)) return { arrayValue: { values: data.map(value) } };
  if (typeof data === 'boolean') return { booleanValue: data };
  if (typeof data === 'number') return { integerValue: String(data) };
  if (typeof data === 'string') return { stringValue: data };
  return { mapValue: { fields: fields(data) } };
}
function fields(data) { return Object.fromEntries(Object.entries(data).map(([key, item]) => [key, value(item)])); }
const create = (ref, data) => ({ update: { name: `${database}/documents/${ref.path}`, fields: fields(data) }, currentDocument: { exists: false } });
const commit = (writes) => firestore.post(`${database}/documents:commit`, { writes });
const collection = (path) => ({ doc: (id) => {
  if (!/^[A-Za-z0-9_-]+$/u.test(id)) throw new Error('Invalid synthetic ID');
  const ref = { path: `${path}/${id}`, collection: (name) => collection(`${path}/${id}/${name}`) };
  return { ...ref, create: (data) => commit([create(ref, data)]) };
} });
const db = { collection, batch: () => {
  const writes = [];
  return { create: (ref, data) => writes.push(create(ref, data)), commit: () => commit(writes) };
} };
const auth = getAuth(app);
const sdk = await stagingWebConfig();
const browser = clientApp(sdk, 'staging-seed-client');
const browserAuth = clientAuth(browser);
const invoke = async (name, data) => (await httpsCallable(getFunctions(browser, 'europe-west1'), name)(data)).data;
const state = { project: STAGING_PROJECT, status: 'in-progress', users: {}, quizzes: [], events: [], registrations: [] };
const save = () => writeFileSync(manifestPath, JSON.stringify(state, null, 2), { mode: 0o600 });
save();
try {
  for (const role of ['admin', 'moderator', 'user']) {
    const email = `${role}-staging@example.test`;
    const password = randomBytes(24).toString('base64url');
    const user = await auth.createUser({ email, password, displayName: `STAGING ${role}`, emailVerified: true });
    state.users[role] = { uid: user.uid, email, password };
    save();
    if (role !== 'user') await auth.setCustomUserClaims(user.uid, { role });
    await db.collection('users').doc(user.uid).create({ email, displayName: `STAGING ${role}`, disabled: false });
  }
  for (let variant = 1; variant <= 2; variant++) {
    const id = `staging-synthetic-quiz-${variant}`;
    const ref = db.collection('quizzes').doc(id);
    const batch = db.batch();
    let position = 0;
    const now = new Date();
    for (let r = 1; r <= 5; r++) {
      const roundId = `round-${r}`;
      const roundTitle = `Kolo ${r} — filmová laboratoř`;
      const common = { roundId, roundTitle, media: [], presentation: {}, options: [] };
      batch.create(ref.collection('rounds').doc(roundId), { title: roundTitle, type: 'classic', position: r, slideCount: 12, questionCount: 10 });
      const slide = (data) => {
        position++;
        const slideId = `slide-${String(position).padStart(3, '0')}`;
        batch.create(ref.collection('slides').doc(slideId), { ...common, ...data, position });
        return slideId;
      };
      slide({ kind: 'round', isQuestion: false, title: roundTitle, text: '' });
      for (let q = 1; q <= 10; q++) {
        // Deliberately invented film scenario, unrelated to any V1 export.
        const answer = `Studio ${r * 100 + q}`;
        const text = `Ve fiktivním filmu Klapka ${r}-${q} má studio číslo rovné součtu ${r * 100} a ${q}. Odpovězte ve tvaru Studio a číslo.`;
        const slideId = slide({ kind: 'free', isQuestion: true, title: '', text, correctAnswer: answer,
          questionNumber: q, questionCount: 10, moderatorNote: 'Syntetický staging obsah, nikoli produkční otázka.' });
        batch.create(ref.collection('rounds').doc(roundId).collection('questions').doc(slideId), {
          type: 'text', prompt: text, correctAnswer: answer, position: q,
        });
      }
      slide({ kind: 'recap', isQuestion: false, title: 'Rekapitulace', text: '' });
    }
    batch.create(ref, { title: variant === 1 ? 'Testovací filmový kvíz' : 'Testovací filmový kvíz — druhá sada',
      description: 'Výhradně syntetický obsah pro staging.', status: 'ready', revision: 0,
      slideCount: position, roundCount: 5, questionCount: 50, createdAt: now, updatedAt: now,
      createdBy: state.users.admin.uid, updatedBy: state.users.admin.uid });
    await batch.commit();
    state.quizzes.push(id); save();
  }
  await signInWithEmailAndPassword(browserAuth, state.users.admin.email, state.users.admin.password);
  for (let i = 0; i < 2; i++) {
    const created = await invoke('createEvent', { expectedRevision: 0, event: {
      title: i === 0 ? 'Testovací filmový kvíz' : 'Testovací filmový kvíz — READY',
      startsAt: new Date(Date.now() + 30 * 86400000).toISOString(), timeZone: 'Europe/Prague',
      venue: { name: 'Syntetický kinosál', publicLocation: 'Testovací prostředí' },
      teamCapacity: 20, peopleCapacity: 100, teamSizeMin: 2, teamSizeMax: 6,
    } });
    state.events.push(created.eventId); save();
    await invoke('lockEventQuiz', { eventId: created.eventId, expectedRevision: 1, quizId: state.quizzes[i], expectedQuizRevision: 0, acknowledgeWarnings: false });
    if (i === 0) await invoke('configureEventRegistration', { eventId: created.eventId, expectedRevision: 2,
      registrationOpensAt: new Date(Date.now() - 60000).toISOString(), registrationClosesAt: new Date(Date.now() + 29 * 86400000).toISOString(), published: true });
  }
  await signOut(browserAuth);
  for (const [i, name] of ['Testovací klapky', 'Testovací reflektory', 'Testovací zrušený tým'].entries()) {
    const created = await invoke('createEventRegistration', { eventId: state.events[0], teamName: name, memberCount: 4, contactEmail: `team-${i}@example.test` });
    state.registrations.push(created); save();
    if (i === 2) await invoke('cancelEventRegistration', { eventId: state.events[0], registrationId: created.registrationId, token: created.managementToken });
  }
  state.status = 'complete'; save();
  console.log('Synthetic staging seed complete. Credentials and management links: .local-data/staging/seed.json (never commit).');
} finally {
  await deleteClientApp(browser);
  await deleteApp(app);
}
