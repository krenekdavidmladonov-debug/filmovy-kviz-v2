import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { getStorage, connectStorageEmulator, ref, uploadBytes } from 'firebase/storage';
import { finalFixture } from './final-reveal-fixture.mjs';
import { syntheticAudio } from './media-fixture.mjs';
import { requireFullEmulatorEnvironment, localEmulatorEndpoint } from '../../tools/local-emulator-environment.mjs';

export const showAudioCueNames = ['intro', 'interim', 'suspense', 'reveal', 'winner'];
export const showDefaults = { schemaVersion: 1, motion: 'subtle', lowerRanks: 'step', topThree: true, winnerAnimation: true,
  audioEnabled: false, volume: .25, fadeInMs: 300, fadeOutMs: 500, cues: {} };
/** Real callable grants + Storage upload; all identifiers are fresh synthetic demo data. */
export async function createShowAudioFixture() {
  const env = requireFullEmulatorEnvironment(process.env, 'Show audio fixture');
  const storageEndpoint = localEmulatorEndpoint(process.env.FIREBASE_STORAGE_EMULATOR_HOST, 'Show audio Storage fixture');
  const f = await finalFixture(4);
  const { quizId } = await f.admin.call('createQuiz', { title: 'Synthetic show audio', requestId: 'show-audio-' + randomUUID() });
  const quizRef = f.db.doc('quizzes/' + quizId), eventRef = f.db.doc('events/' + f.eventId);
  const storage = getStorage(f.admin.auth.app, 'gs://' + env.projectId + '.appspot.com');
  connectStorageEmulator(storage, storageEndpoint.host, storageEndpoint.port);
  const require = createRequire(new URL('../../functions/package.json', import.meta.url));
  const app = require('firebase-admin/app').initializeApp({ projectId: env.projectId }, 'show-audio-storage-' + randomUUID());
  const bucket = require('firebase-admin/storage').getStorage(app).bucket(env.projectId + '.appspot.com');
  const upload = async (seconds = 12) => {
    const bytes = syntheticAudio(seconds), target = await f.admin.call('beginQuizMediaUpload', { quizId, requestId: randomUUID(), kind: 'audio', contentType: 'audio/wav', size: bytes.length });
    await uploadBytes(ref(storage, target.path), bytes, { contentType: 'audio/wav' });
    const ready = await f.admin.call('finalizeQuizMediaUpload', { quizId, assetId: target.assetId });
    return { ...target, reference: ready.reference, bytes };
  };
  const audio = await upload();
  await eventRef.update({ 'quizAssignment.quizId': quizId, 'quizAssignment.quizTitle': 'Synthetic show audio' });
  await f.db.doc('quizSnapshots/' + f.snapshotId).update({ quizId });
  await f.db.doc('sessions/' + f.sessionId).update({ quizId });
  await f.db.doc(`quizSnapshots/${f.snapshotId}/slides/s2`).update({ mediaSource: audio.reference, clipStartSeconds: 0, clipEndSeconds: 12 });
  const configure = async preferences => {
    const event = (await eventRef.get()).data();
    return f.admin.call('configureEventShow', { eventId: f.eventId, expectedRevision: event.revision, preferences });
  };
  const read = async (reference = audio.reference, who = f.admin, extra = {}) => {
    const url = new URL(`http://${env.functionsEndpoint.host}:${env.functionsEndpoint.port}/${env.projectId}/europe-west1/readQuizMedia`);
    url.searchParams.set('eventId', f.eventId); url.searchParams.set('reference', reference);
    for (const [key, value] of Object.entries(extra)) url.searchParams.set(key, value);
    const headers = who.auth.currentUser ? { Authorization: 'Bearer ' + await who.auth.currentUser.getIdToken() } : {};
    return fetch(url, { headers });
  };
  return { ...f, quizId, quizRef, eventRef, audio, upload, configure, read,
    async dispose() {
      requireFullEmulatorEnvironment(process.env, 'Show audio cleanup');
      localEmulatorEndpoint(process.env.FIREBASE_STORAGE_EMULATOR_HOST, 'Show audio cleanup Storage');
      await bucket.deleteFiles({ prefix: 'quiz-assets/' + quizId + '/' });
      await f.db.recursiveDelete(quizRef); await f.db.recursiveDelete(eventRef);
      await f.db.doc('publicEvents/' + f.eventId).delete();
      await f.db.recursiveDelete(f.db.doc('quizSnapshots/' + f.snapshotId));
      await f.db.recursiveDelete(f.db.doc('sessions/' + f.sessionId));
      await f.db.doc('publicSessions/' + f.sessionId).delete();
      await f.db.doc('memberships/' + f.admin.uid).delete(); await f.db.doc('memberships/' + f.moderator.uid).delete();
      await require('firebase-admin/app').deleteApp(app); await f.close();
    },
  };
}

export async function runShowAudioEmulator() {
  const f = await createShowAudioFixture(); let assertions = 0;
  const deny = (promise, code) => assert.rejects(promise, e => e.code === 'functions/' + code);
  try {
    const initial = await f.admin.call('readEventShowPreferences', { eventId: f.eventId });
    assert.deepEqual(initial.preferences, showDefaults); assertions++;
    const preferences = { ...showDefaults, audioEnabled: true, cues: Object.fromEntries(showAudioCueNames.map(cue => [cue, f.audio.reference])) };
    const saved = await f.configure(preferences);
    assert.equal(saved.revision, initial.revision + 1); assert.deepEqual(saved.preferences, preferences); assertions++;
    const reloaded = await f.moderator.call('readEventShowPreferences', { eventId: f.eventId });
    assert.deepEqual(reloaded.preferences, preferences); assertions++;
    await deny(f.admin.call('configureEventShow', { eventId: f.eventId, expectedRevision: initial.revision, preferences }), 'aborted'); assertions++;
    for (const patch of [{ cues: { third: f.audio.reference } }, { cues: { intro: 'https://example.test/music.mp3' } }, { volume: 2 }, { fadeOutMs: 2001 }, { rows: [] }]) {
      await deny(f.configure({ ...preferences, ...patch }), 'invalid-argument'); assertions++;
    }
    assert.equal((await f.read()).status, 200); assert.equal((await f.read(f.audio.reference, f.anonymous)).status, 403); assertions += 2;
    assert.equal((await f.read(f.audio.reference, f.admin, { sessionId: f.sessionId })).status, 400); assertions++;
    const missing = await f.upload(); assert.equal((await f.read(missing.reference)).status, 404); assertions++;
    await deny(f.anonymous.call('readEventShowPreferences', { eventId: f.eventId }), 'unauthenticated'); assertions++;
    const memberRef = f.db.doc('memberships/' + f.moderator.uid), original = (await memberRef.get()).data();
    await memberRef.update({ permissions: original.permissions.filter(p => p !== 'event.live'), version: original.version + 1 });
    await deny(f.moderator.call('readEventShowPreferences', { eventId: f.eventId }), 'permission-denied');
    assert.equal((await f.read(f.audio.reference, f.moderator)).status, 404); assertions += 2;
    await memberRef.set(original);
    await f.configure({ ...preferences, cues: {} }); assert.equal((await f.read()).status, 404); assertions++;
    await f.configure(preferences);
    const assetRef = f.quizRef.collection('mediaAssets').doc(f.audio.assetId), metadata = (await assetRef.get()).data();
    await assetRef.update({ generation: String(Number(metadata.generation) + 1) }); assert.equal((await f.read()).status, 404); assertions++;
    await assetRef.set(metadata);
    const publicBytes = JSON.stringify(await f.rawPublic());
    assert(!publicBytes.includes('showPreferences') && !publicBytes.includes('showAudioBindings') && !publicBytes.includes(f.audio.reference)); assertions++;
    await f.authAdmin.updateUser(f.admin.uid, { disabled: true }); assert.equal((await f.read()).status, 404); assertions++;
    await f.authAdmin.updateUser(f.admin.uid, { disabled: false });
    await f.eventRef.update({ lifecycleStatus: 'cancelled' }); assert.equal((await f.read()).status, 404); assertions++;
    console.log(JSON.stringify({ suite: 'show-audio-emulator', assertions, status: 'PASS', project: 'demo-only', cues: showAudioCueNames }));
  } finally { await f.dispose(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await runShowAudioEmulator();
