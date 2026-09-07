import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { getFirestore, getDoc, getDocs, collection, doc, updateDoc } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { assertStagingProject, STAGING_PROJECT, STAGING_URL } from './guard.mjs';
import { stagingWebConfig } from './cloud.mjs';

assertStagingProject(process.argv[2]);
const seed = JSON.parse(readFileSync(new URL('../../.local-data/staging/seed.json', import.meta.url), 'utf8'));
assertStagingProject(seed.project);
assert.equal(seed.status, 'complete');
const app = initializeApp(await stagingWebConfig(), 'staging-smoke');
const auth = getAuth(app);
const db = getFirestore(app);
const invoke = async (name, data) => (await httpsCallable(getFunctions(app, 'europe-west1'), name)(data)).data;
const login = async (role) => {
  const u = seed.users[role];
  await signInWithEmailAndPassword(auth, u.email, u.password);
};
const eventId = seed.events[0];
const privateQuiz = doc(db, 'quizzes', seed.quizzes[0]);
const eventRef = doc(db, 'events', eventId);
const registrations = collection(db, 'events', eventId, 'registrations');
const deny = async (promise) => assert.rejects(promise, (e) => /permission-denied|unauthenticated/u.test(e.code));
const rejected = async (promise) => assert.rejects(promise, (e) => /invalid-argument|failed-precondition|already-exists|resource-exhausted/u.test(e.code));
async function pdf(options, status = 200) {
  const token = auth.currentUser ? await auth.currentUser.getIdToken() : undefined;
  const r = await fetch(`https://europe-west1-${STAGING_PROJECT}.cloudfunctions.net/generatePrintArtifact`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ eventId, options }),
  });
  assert.equal(r.status, status);
  if (status === 200) {
    assert.equal(r.headers.get('cache-control'), 'no-store');
    const bytes = new Uint8Array(await r.arrayBuffer());
    assert.equal(new TextDecoder().decode(bytes.slice(0, 5)), '%PDF-');
    assert.ok(bytes.length > 1000);
  }
}
const key = { artifactType: 'answer-key', disposition: 'inline' };
try {
  const hosting = await fetch(`${STAGING_URL}/events`);
  assert.equal(hosting.status, 200);
  assert.match(hosting.headers.get('x-robots-tag') ?? '', /noindex/u);
  await deny(getDoc(privateQuiz));
  await deny(getDocs(registrations));
  await pdf(key, 401);
  const publicEvent = (await getDoc(doc(db, 'publicEvents', eventId))).data();
  assert.ok(publicEvent);
  for (const field of ['quizAssignment', 'correctAnswer', 'contactEmail', 'managementTokenHash', 'legacy']) assert.equal(field in publicEvent, false);
  assert.equal(JSON.stringify(publicEvent).includes('@example.test'), false);
  await login('user');
  await deny(getDoc(privateQuiz));
  await deny(getDocs(registrations));
  await pdf(key, 403);
  await login('moderator');
  assert.ok((await getDoc(privateQuiz)).exists());
  await deny(updateDoc(eventRef, { title: 'Forbidden staging smoke' }));
  await deny(invoke('updateQuizMetadata', { quizId: seed.quizzes[0], expectedRevision: 0, quiz: { title: 'Forbidden', description: '' } }));
  await pdf(key, 403);
  await pdf({ artifactType: 'score-table', disposition: 'inline' });
  await login('admin');
  await deny(updateDoc(privateQuiz, { title: 'Forbidden staging smoke' }));
  await deny(updateDoc(eventRef, { title: 'Forbidden staging smoke' }));
  const event = (await getDoc(eventRef)).data();
  const snapshot = doc(db, 'quizSnapshots', event.quizAssignment.snapshotId);
  await deny(updateDoc(snapshot, { quizRevision: 999 }));
  await pdf(key);
  for (const options of [
    { artifactType: 'team-sheets', mode: 'generic', disposition: 'inline' },
    { artifactType: 'team-sheets', mode: 'single', teamId: seed.registrations[0].registrationId, disposition: 'inline' },
    { artifactType: 'team-sheets', mode: 'all', disposition: 'inline' },
    { artifactType: 'score-table', disposition: 'attachment' },
  ]) await pdf(options);
  await signOut(auth);
  const form = { eventId, teamName: `Smoke ${Date.now()}`, memberCount: 3, contactEmail: 'smoke@example.test' };
  await rejected(invoke('createEventRegistration', { ...form, memberCount: 1 }));
  await rejected(invoke('createEventRegistration', { ...form, memberCount: 7 }));
  const created = await invoke('createEventRegistration', form);
  const management = { eventId, registrationId: created.registrationId, token: created.managementToken };
  try {
    await rejected(invoke('createEventRegistration', form));
    await invoke('getEventRegistration', management);
    await assert.rejects(invoke('getEventRegistration', { ...management, token: 'invalid-token' }));
    await invoke('updateEventRegistration', { ...management, teamName: `${form.teamName} edit`, memberCount: 2, contactEmail: 'edited@example.test' });
  } finally { await invoke('cancelEventRegistration', management); }
  await login('admin');
  // Tiny isolated capacity cases: at most two calls for each bound, no load test.
  for (const [teamCapacity, peopleCapacity, count] of [[1, 10, 2], [3, 3, 2]]) {
    const c = await invoke('createEvent', { expectedRevision: 0, event: {
      title: 'STAGING capacity smoke', startsAt: new Date(Date.now() + 86400000).toISOString(), timeZone: 'Europe/Prague',
      venue: { name: 'Test', publicLocation: 'Test' }, teamCapacity, peopleCapacity, teamSizeMin: 2, teamSizeMax: 3,
    } });
    await invoke('configureEventRegistration', { eventId: c.eventId, expectedRevision: 1, published: true,
      registrationOpensAt: new Date(Date.now() - 60000).toISOString(), registrationClosesAt: new Date(Date.now() + 3600000).toISOString() });
    await signOut(auth);
    await invoke('createEventRegistration', { eventId: c.eventId, teamName: 'Capacity A', memberCount: count, contactEmail: 'capacity@example.test' });
    await rejected(invoke('createEventRegistration', { eventId: c.eventId, teamName: 'Capacity B', memberCount: count, contactEmail: 'capacity@example.test' }));
    await login('admin');
    const current = (await getDoc(doc(db, 'events', c.eventId))).data();
    await invoke('cancelEvent', { eventId: c.eventId, expectedRevision: current.revision });
  }
  const live = await invoke('createLiveSession', { quizId: seed.quizzes[0] });
  let result = live;
  for (const operation of ['nextSlide', 'nextSlide', 'previousSlide']) {
    result = await invoke(operation, { sessionId: live.sessionId, expectedRevision: result.revision });
    const p = (await getDoc(doc(db, 'publicSessions', live.sessionId))).data();
    for (const field of ['correctAnswer', 'revealedAnswer', 'moderatorNote', 'legacy']) assert.equal(field in p, false);
  }
  result = await invoke('goToSlide', { sessionId: live.sessionId, expectedRevision: result.revision, position: 12 });
  result = await invoke('selectRecapQuestion', { sessionId: live.sessionId, expectedRevision: result.revision, position: 2 });
  const recap = (await getDoc(doc(db, 'publicSessions', live.sessionId))).data();
  assert.equal(recap.answerRevealed, true);
  assert.ok(recap.revealedAnswer);
  await invoke('endLiveSession', { sessionId: live.sessionId, expectedRevision: result.revision });
  console.log('PASS: deployed staging Hosting, roles/Rules, registrations/management/capacities, private PDF, live/recap.');
} finally { await deleteApp(app); }
