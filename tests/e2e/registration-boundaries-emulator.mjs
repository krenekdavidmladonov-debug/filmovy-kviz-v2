import { strict as assert } from 'node:assert';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { getFunctions, connectFunctionsEmulator, httpsCallable } from 'firebase/functions';
import { getFirestore, connectFirestoreEmulator, doc, getDoc, getDocs, collection, setDoc } from 'firebase/firestore';
import { requireFullEmulatorEnvironment } from '../../tools/local-emulator-environment.mjs';

const env = requireFullEmulatorEnvironment(process.env, 'Registration boundaries');
function client(name) {
  const app = initializeApp({ apiKey: 'demo-api-key', projectId: env.projectId }, name);
  const auth = getAuth(app);
  connectAuthEmulator(auth, `http://${env.authEndpoint.host}:${env.authEndpoint.port}`, { disableWarnings: true });
  const functions = getFunctions(app, 'europe-west1');
  connectFunctionsEmulator(functions, env.functionsEndpoint.host, env.functionsEndpoint.port);
  const db = getFirestore(app);
  connectFirestoreEmulator(db, env.firestoreEndpoint.host, env.firestoreEndpoint.port);
  return { app, auth, db, call: async (name, data) => (await httpsCallable(functions, name)(data)).data };
}
const admin = client('boundary-admin');
const user = client('boundary-user');
const login = (client, role) => signInWithEmailAndPassword(client.auth, `${role}@example.test`, 'LocalQuiz123!');
const form = (teamName, memberCount) => ({ teamName, memberCount, contactEmail: 'synthetic@example.test' });
const config = (teams = 3, people = 12) => ({ title: 'Syntetické hranice', startsAt: '2031-01-01T18:00:00Z', timeZone: 'Europe/Prague', venue: { name: 'Test', publicLocation: 'Test' }, teamCapacity: teams, peopleCapacity: people, teamSizeMin: 2, teamSizeMax: 6 });
const state = async (id) => (await getDoc(doc(admin.db, 'events', id))).data();
async function window(id, published, expired = false) {
  return admin.call('configureEventRegistration', { eventId: id, expectedRevision: (await state(id)).revision, published,
    registrationOpensAt: '2020-01-01T00:00:00Z', registrationClosesAt: expired ? '2021-01-01T00:00:00Z' : '2030-01-01T00:00:00Z' });
}
async function event(teams = 3, people = 12) {
  const result = await admin.call('createEvent', { expectedRevision: 0, event: config(teams, people) });
  await window(result.eventId, true);
  return result.eventId;
}
const managed = (id, registration) => ({ eventId: id, registrationId: registration.registrationId, token: registration.managementToken });
const denied = (promise, code) => assert.rejects(promise, (error) => error.code === `functions/${code}`);
async function run() {
  await login(admin, 'admin');
  const id = await event();
  const own = await user.call('createEventRegistration', { eventId: id, ...form('Vlastní tým', 3) });
  const other = await user.call('createEventRegistration', { eventId: id, ...form('Jiný tým', 3) });
  for (const role of [null, 'user', 'moderator']) {
    if (role) await login(user, role); else await signOut(user.auth);
    assert.equal((await user.call('getEventRegistration', managed(id, own))).teamName, 'Vlastní tým');
    await user.call('updateEventRegistration', { ...managed(id, own), ...form('Vlastní tým', 2) });
    await denied(user.call('getEventRegistration', { ...managed(id, other), token: own.managementToken }), 'not-found');
    await denied(user.call('updateEventRegistration', { ...managed(id, other), token: own.managementToken, ...form('Cizí změna', 2) }), 'not-found');
    await denied(user.call('cancelEventRegistration', { ...managed(id, other), token: own.managementToken }), 'not-found');
    await denied(user.call('adminCancelEventRegistration', { eventId: id, registrationId: other.registrationId }), role ? 'permission-denied' : 'unauthenticated');
    await assert.rejects(setDoc(doc(user.db, 'events', id, 'registrations', own.registrationId), { status: 'cancelled' }));
    if (role !== 'moderator') await assert.rejects(getDocs(collection(user.db, 'events', id, 'registrations')));
  }
  await user.call('cancelEventRegistration', managed(id, own));
  await signOut(user.auth);
  const full = await event(1, 6);
  const fullTeam = await user.call('createEventRegistration', { eventId: full, ...form('Plný tým', 6) });
  await denied(user.call('createEventRegistration', { eventId: full, ...form('Další tým', 2) }), 'failed-precondition');
  await user.call('updateEventRegistration', { ...managed(full, fullTeam), ...form('Plný tým', 3) });
  await user.call('cancelEventRegistration', managed(full, fullTeam));
  assert.equal((await state(full)).acceptedTeams, 0);
  for (const expired of [false, true]) {
    const closed = await event(1, 6);
    const team = await user.call('createEventRegistration', { eventId: closed, ...form('Uzavřený tým', 4) });
    await window(closed, expired, expired);
    await denied(user.call('updateEventRegistration', { ...managed(closed, team), ...form('Uzavřený tým', 2) }), 'failed-precondition');
    await denied(user.call('cancelEventRegistration', managed(closed, team)), 'failed-precondition');
    await admin.call('adminCancelEventRegistration', { eventId: closed, registrationId: team.registrationId });
    assert.equal((await state(closed)).registrationStatus, 'closed');
    await denied(user.call('createEventRegistration', { eventId: closed, ...form('Znovu tým', 2) }), 'failed-precondition');
  }
  const shrink = await event(3, 12);
  await user.call('createEventRegistration', { eventId: shrink, ...form('První tým', 4) });
  await user.call('createEventRegistration', { eventId: shrink, ...form('Druhý tým', 4) });
  for (const change of [{ ...config(), teamCapacity: 1 }, { ...config(), peopleCapacity: 6 }]) {
    await denied(admin.call('updateEvent', { eventId: shrink, expectedRevision: (await state(shrink)).revision, event: change }), 'failed-precondition');
  }
  const race = await event(2, 12);
  await user.call('createEventRegistration', { eventId: race, ...form('Základní tým', 4) });
  const revision = (await state(race)).revision;
  const results = await Promise.allSettled([
    admin.call('updateEvent', { eventId: race, expectedRevision: revision, event: config(1, 6) }),
    user.call('createEventRegistration', { eventId: race, ...form('Souběžný tým', 4) }),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  const final = await state(race);
  assert.ok(final.acceptedTeams <= final.teamCapacity && final.acceptedPeople <= final.peopleCapacity);
  console.log('PASS: full versus closed, capacity shrink including race, token management across anonymous/user/moderator and negative authorization');
}
try { await run(); } finally { await Promise.all([deleteApp(admin.app), deleteApp(user.app)]); }
