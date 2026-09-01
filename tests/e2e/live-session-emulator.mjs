import { strict as assert } from 'node:assert';

import { deleteApp, initializeApp } from 'firebase/app';
import {
  connectAuthEmulator,
  getAuth,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth';
import {
  connectFirestoreEmulator,
  doc,
  getDoc,
  getFirestore,
} from 'firebase/firestore';
import {
  connectFunctionsEmulator,
  getFunctions,
  httpsCallable,
} from 'firebase/functions';

const projectId = globalThis.process.env.GCLOUD_PROJECT ?? globalThis.process.env.GOOGLE_CLOUD_PROJECT;
if (!projectId?.startsWith('demo-')) throw new Error('E2E requires a demo-* project ID.');
if (!['127.0.0.1:8080', 'localhost:8080'].includes(globalThis.process.env.FIRESTORE_EMULATOR_HOST)) {
  throw new Error('E2E requires the local Firestore Emulator.');
}
if (!['127.0.0.1:9099', 'localhost:9099'].includes(globalThis.process.env.FIREBASE_AUTH_EMULATOR_HOST)) {
  throw new Error('E2E requires the local Authentication Emulator.');
}
if (!['127.0.0.1:5001', 'localhost:5001'].includes(globalThis.process.env.FUNCTIONS_EMULATOR_HOST)) {
  throw new Error('E2E requires the local Functions Emulator.');
}

const options = {
  apiKey: 'demo-api-key',
  authDomain: `${projectId}.firebaseapp.com`,
  projectId,
  appId: '1:123:web:live-session-e2e',
};
const staffApp = initializeApp(options, 'live-session-e2e-staff');
const projectorApp = initializeApp(options, 'live-session-e2e-projector');
const auth = getAuth(staffApp);
const staffDb = getFirestore(staffApp);
const projectorDb = getFirestore(projectorApp);
const functions = getFunctions(staffApp, 'europe-west1');

connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
connectFirestoreEmulator(staffDb, '127.0.0.1', 8080);
connectFirestoreEmulator(projectorDb, '127.0.0.1', 8080);
connectFunctionsEmulator(functions, '127.0.0.1', 5001);

const invoke = async (name, data) => (await httpsCallable(functions, name)(data)).data;

async function expectFunctionError(action, code) {
  try {
    await action();
    assert.fail(`Expected ${code}.`);
  } catch (error) {
    assert.equal(error.code, code);
  }
}

function keysDeep(value) {
  if (Array.isArray(value)) return value.flatMap(keysDeep);
  if (value === null || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, nested]) => [key, ...keysDeep(nested)]);
}

function assertPublicSafe(data, revealed) {
  const keys = keysDeep(data);
  const serialized = JSON.stringify(data);
  for (const forbidden of ['correctAnswer', 'correct', 'moderatorNote', 'legacy', 'raw']) {
    assert.equal(keys.includes(forbidden), false, `Public state contains forbidden key ${forbidden}.`);
  }
  for (const privateSentinel of ['Never publish this raw field', 'Never publish this note', 'Pouze moderátor']) {
    assert.equal(serialized.includes(privateSentinel), false, 'Public state contains a private sentinel value.');
  }
  assert.equal(data.answerRevealed, revealed);
  assert.equal(Object.hasOwn(data, 'revealedAnswer'), revealed);
  if (!revealed) assert.equal(Object.hasOwn(data, 'answerImage'), false);
}

async function publicState(sessionId) {
  const snapshot = await getDoc(doc(projectorDb, 'publicSessions', sessionId));
  assert.equal(snapshot.exists(), true);
  return snapshot.data();
}

async function run() {
  await expectFunctionError(
    () => invoke('createLiveSession', { quizId: 'live-session-e2e' }),
    'functions/unauthenticated',
  );

  await signInWithEmailAndPassword(auth, 'user@example.test', 'LocalQuiz123!');
  await expectFunctionError(
    () => invoke('createLiveSession', { quizId: 'live-session-e2e' }),
    'functions/permission-denied',
  );
  await signOut(auth);

  await signInWithEmailAndPassword(auth, 'moderator@example.test', 'LocalQuiz123!');
  const created = await invoke('createLiveSession', { quizId: 'live-session-e2e' });
  assert.equal(created.currentSlidePosition, 0);
  assert.equal(created.answerRevealed, false);
  assert.equal(created.revision, 0);
  const sessionId = created.sessionId;

  let state = await publicState(sessionId);
  assert.equal(state.status, 'waiting');
  assertPublicSafe(state, false);

  await expectFunctionError(
    () => invoke('goToSlide', { sessionId, position: 99, expectedRevision: 0 }),
    'functions/invalid-argument',
  );

  await assert.rejects(getDoc(doc(projectorDb, 'sessions', sessionId)), /permission-denied/u);
  await assert.rejects(getDoc(doc(projectorDb, 'quizzes', 'live-session-e2e', 'slides', 'slide-002')), /permission-denied/u);

  let control = await invoke('nextSlide', { sessionId, expectedRevision: 0 });
  assert.equal(control.currentSlidePosition, 1);
  state = await publicState(sessionId);
  assert.equal(state.slideKind, 'intro');
  assertPublicSafe(state, false);

  control = await invoke('nextSlide', { sessionId, expectedRevision: control.revision });
  assert.equal(control.currentSlidePosition, 2);
  state = await publicState(sessionId);
  assert.equal(state.slideKind, 'question');
  assertPublicSafe(state, false);
  assert.equal(JSON.stringify(state).includes('Syntetická odpověď'), false);
  assert.equal(JSON.stringify(state).includes('answer.jpg'), false);

  control = await invoke('revealAnswer', { sessionId, expectedRevision: control.revision });
  state = await publicState(sessionId);
  assertPublicSafe(state, true);
  assert.equal(state.revealedAnswer, 'Syntetická odpověď');
  assert.equal(state.answerImage, 'https://example.test/answer.jpg');

  control = await invoke('nextSlide', { sessionId, expectedRevision: control.revision });
  state = await publicState(sessionId);
  assert.equal(state.slidePosition, 3);
  assertPublicSafe(state, false);

  const doubleClickRevision = control.revision;
  const doubleClick = await Promise.allSettled([
    invoke('nextSlide', { sessionId, expectedRevision: doubleClickRevision }),
    invoke('nextSlide', { sessionId, expectedRevision: doubleClickRevision }),
  ]);
  assert.equal(doubleClick.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(doubleClick.filter((result) => result.status === 'rejected').length, 1);
  control = doubleClick.find((result) => result.status === 'fulfilled').value;
  assert.equal(control.currentSlidePosition, 4);

  const raceRevision = control.revision;
  const race = await Promise.allSettled([
    invoke('revealAnswer', { sessionId, expectedRevision: raceRevision }),
    invoke('nextSlide', { sessionId, expectedRevision: raceRevision }),
  ]);
  assert.equal(race.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(race.filter((result) => result.status === 'rejected').length, 1);
  control = race.find((result) => result.status === 'fulfilled').value;
  state = await publicState(sessionId);
  assertPublicSafe(state, control.answerRevealed);

  if (control.currentSlidePosition === 4) {
    control = await invoke('nextSlide', { sessionId, expectedRevision: control.revision });
  }
  state = await publicState(sessionId);
  assert.equal(state.slidePosition, 5);
  assertPublicSafe(state, false);

  await expectFunctionError(
    () => invoke('previousSlide', { sessionId, expectedRevision: raceRevision }),
    'functions/aborted',
  );

  const ended = await invoke('endLiveSession', { sessionId, expectedRevision: control.revision });
  assert.equal(ended.status, 'ended');
  state = await publicState(sessionId);
  assert.equal(state.status, 'ended');
  assertPublicSafe(state, false);
  assert.equal(Object.hasOwn(state, 'slideKind'), false);
  await expectFunctionError(
    () => invoke('nextSlide', { sessionId, expectedRevision: ended.revision }),
    'functions/failed-precondition',
  );

  await signOut(auth);
  await signInWithEmailAndPassword(auth, 'admin@example.test', 'LocalQuiz123!');
  const adminSession = await invoke('createLiveSession', { quizId: 'live-session-e2e' });
  assert.equal(adminSession.status, 'waiting');

  await signOut(auth);
  await signInWithEmailAndPassword(auth, 'user@example.test', 'LocalQuiz123!');
  await assert.rejects(getDoc(doc(staffDb, 'sessions', adminSession.sessionId)), /permission-denied/u);

  globalThis.console.log(JSON.stringify({
    status: 'PASS',
    anonymousProjector: true,
    staffRolesVerified: ['moderator', 'admin'],
    normalUserDenied: true,
    answerLeakBeforeReveal: false,
    staleAndConcurrentOperationsVerified: true,
    endedStateVerified: true,
  }, null, 2));
}

try {
  await run();
} finally {
  await Promise.all([deleteApp(staffApp), deleteApp(projectorApp)]);
}
