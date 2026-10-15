import { strict as assert } from 'node:assert';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { EmailDeliveryError } from '../../functions/lib/email/errors.js';
import { emailFixture } from './registration-email-fixture.mjs';

let fixture;
let phase = 'setup';
const secrets = [];
const check = (condition, label) => { if (!condition) phase = label; assert.ok(condition, label); };
const denied = (promise, code) => assert.rejects(promise, error => error.code === `functions/${code}`);
try {
  fixture = await emailFixture();
  const { eventId, eventRef, publicCall, adminCall, capture } = fixture;
  const input = (teamName, memberCount = 4) => ({ teamName, memberCount, contactEmail: 'synthetic@example.test' });
  const key = () => { const result = randomBytes(32).toString('base64url'); secrets.push(result); return result; };
  const create = async (name, requestKey = key()) => {
    const value = await publicCall('createEventRegistration', { eventId, requestKey, ...input(name) });
    secrets.push(value.managementToken); return value;
  };
  const managed = value => ({ eventId, registrationId: value.registrationId, token: value.managementToken });
  const list = value => fixture.intents(value.registrationId);
  const record = async value => (await eventRef.collection('registrations').doc(value.registrationId).get()).data();
  const persistedState = async () => {
    const documents = [await eventRef.get(), await fixture.db.collection('publicEvents').doc(eventId).get()];
    for (const name of ['registrations', 'registrationNames', 'registrationOperations', 'emailIntents', 'emailSecrets']) {
      documents.push(...(await eventRef.collection(name).get()).docs);
    }
    return documents.sort((a, b) => a.ref.path.localeCompare(b.ref.path)).map(doc => ({
      path: doc.ref.path, data: doc.data(), updateTime: [doc.updateTime.seconds, doc.updateTime.nanoseconds],
    }));
  };
  phase = 'pre-activation creation receipt without token envelope';
  const historicalKey = key(), historicalName = 'Historický cloudový tým';
  const historicalTeam = await create(historicalName, historicalKey);
  const historicalIntent = (await list(historicalTeam))[0];
  const historicalRef = eventRef.collection('registrations').doc(historicalTeam.registrationId);
  const historicalSecret = eventRef.collection('emailSecrets').doc(historicalIntent.id);
  check((await historicalSecret.get()).exists, 'Fixture first creates a real emulator envelope');
  // Reproduce the cloud/pre-activation persisted shape without changing runtime gates:
  // the create receipt, token verifier, reservation and counters remain unchanged.
  const historicalData = await record(historicalTeam);
  delete historicalData.emailDelivery;
  const historyBatch = fixture.db.batch();
  historyBatch.set(historicalRef, historicalData);
  historyBatch.delete(historicalSecret);
  historyBatch.delete(historicalIntent.ref);
  await historyBatch.commit();
  const historicalBefore = await persistedState();
  const historicalReplays = await Promise.all([create(historicalName, historicalKey), create(historicalName, historicalKey)]);
  check(historicalReplays.every(value => value.registrationId === historicalTeam.registrationId && value.managementToken === historicalTeam.managementToken), 'Absent historical envelope recovers the exact existing registration and token');
  assert.deepEqual(await persistedState(), historicalBefore);
  await denied(publicCall('createEventRegistration', { eventId, requestKey: historicalKey, ...input('Changed historical payload') }), 'already-exists');
  assert.deepEqual(await persistedState(), historicalBefore);
  for (const corrupt of [{}, { envelope: { version: 1, keyId: 'demo-fixture-v1', nonce: '', ciphertext: '', tag: '' } }]) {
    await historicalSecret.set(corrupt);
    const before = await persistedState();
    await denied(create(historicalName, historicalKey), 'internal');
    assert.deepEqual(await persistedState(), before);
  }
  await historicalSecret.delete();
  await eventRef.update({ capabilityVersion: (historicalData.capabilityVersion ?? 0) + 1 });
  const revokedBefore = await persistedState();
  await denied(create(historicalName, historicalKey), 'permission-denied');
  assert.deepEqual(await persistedState(), revokedBefore);
  const rotated = await adminCall('adminUpdateEventTeam', { action: 'reissueLink', eventId, registrationId: historicalTeam.registrationId, expectedRevision: historicalData.revision ?? 0, requestId: randomUUID() });
  check(typeof rotated.managementToken === 'string' && rotated.managementToken !== historicalTeam.managementToken, 'Reissue rotates the current management capability');
  secrets.push(rotated.managementToken);
  const rotatedBefore = await persistedState();
  await denied(create(historicalName, historicalKey), 'not-found');
  check((await publicCall('getEventRegistration', { ...managed(historicalTeam), token: rotated.managementToken })).registrationId === historicalTeam.registrationId, 'Current reissued token remains valid');
  assert.deepEqual(await persistedState(), rotatedBefore);
  check((await list(historicalTeam)).length === 0 && !(await historicalSecret.get()).exists, 'Historical replay never creates email intents or envelopes');
  console.log('PASS: pre-activation receipt replay has no writes; changed payload, corrupt envelope, revoked capability and rotated token denied');

  phase = 'create atomicity and concurrent/lost-response replay';
  const retryKey = key();
  const [team, replay] = await Promise.all([create('Emailový tým', retryKey), create('Emailový tým', retryKey)]);
  check(team.registrationId === replay.registrationId && team.managementToken === replay.managementToken, phase);
  check((await list(team)).length === 1, 'Exactly one creation intent');
  const confirmed = (await list(team))[0];
  check(confirmed.data().type === 'registration-confirmed' && confirmed.data().recipient === 'synthetic@example.test', 'Authoritative type/recipient');
  check(confirmed.data().content.eventTitle === 'Syntetický emailový večer' && confirmed.data().content.teamName === 'Emailový tým', 'Authoritative event/team');
  await denied(publicCall('createEventRegistration', { eventId, requestKey: retryKey, ...input('Different replay') }), 'already-exists');
  console.log('PASS: atomic public create, concurrent replay, payload mismatch, exactly one intent');

  phase = 'provider failure independent of registration, safe error and retry';
  check(team.status === 'accepted' && confirmed.data().status === 'pending', 'Registration accepted before any transport');
  const leakingProvider = { send: () => Promise.reject(new EmailDeliveryError('provider-unavailable', true)) };
  check(await fixture.deliver(confirmed.ref, undefined, leakingProvider) === 'pending', phase);
  check((await confirmed.ref.get()).data().lastError === 'provider-unavailable' && (await record(team)).emailDelivery.status === 'pending', 'Safe failed status');
  fixture.advance();
  check(await fixture.deliver(confirmed.ref) === 'sent', 'Successful retry');
  check(await fixture.deliver(confirmed.ref) === 'unchanged', 'Repeated delivery is a no-op');
  const delivered = (await confirmed.ref.get()).data();
  check(delivered.attempts === 2 && delivered.sentAt && delivered.lastError === null, 'Persisted successful delivery');
  const message = capture.messages.get(confirmed.ref.path);
  check(message.to === 'synthetic@example.test' && message.subject === 'JustKvíz | Registrace týmu Emailový tým potvrzena', 'Capture subject/recipient');
  check(message.text.includes('Syntetický sál') && message.text.includes('19:00') && message.text.includes('Počet hráčů: 4'), 'Capture content');
  const link = new URL(/Spravovat registraci: (\S+)/u.exec(message.text)[1]);
  const params = new URLSearchParams(link.hash.slice(1));
  check(params.get('token') === team.managementToken && params.get('registration') === team.registrationId, 'CTA belongs to original registration');
  check((await publicCall('getEventRegistration', { eventId, registrationId: params.get('registration'), token: params.get('token') })).registrationId === team.registrationId, 'Captured CTA authorizes management');
  check((await create('Emailový tým', retryKey)).managementToken === team.managementToken, 'Create response recovery remains possible after delivery');
  console.log('PASS: provider outage, sanitized error, sent status, independent retry and real CTA');

  phase = 'updates, no-ops and delayed operation retries';
  const changeId = randomUUID(), noopId = randomUUID();
  const change = { ...managed(team), requestId: changeId, ...input('Změněný tým', 3) };
  await Promise.all([publicCall('updateEventRegistration', change), publicCall('updateEventRegistration', change)]);
  await publicCall('updateEventRegistration', { ...change, requestId: noopId });
  check((await list(team)).length === 2, 'One real change, no no-op/retry message');
  const changedIntent = (await list(team)).find(doc => doc.data().type === 'registration-updated');
  const changedSecret = (await eventRef.collection('emailSecrets').doc(changedIntent.id).get()).data();
  check(fixture.vault.open(changedSecret.envelope, changedIntent.ref.path) === team.managementToken, 'Update envelope contains the same verified capability');
  check((await eventRef.collection('emailSecrets').get()).size === 2, 'Replay and no-op mint no further encrypted envelopes');
  await publicCall('updateEventRegistration', { ...managed(team), requestId: randomUUID(), ...input('Nejnovější tým', 2), contactEmail: 'updated@example.test' });
  await publicCall('updateEventRegistration', change);
  await publicCall('updateEventRegistration', { ...change, requestId: noopId });
  check((await record(team)).teamName === 'Nejnovější tým' && (await list(team)).length === 3, 'Delayed retries do not restore stale state');
  await denied(publicCall('updateEventRegistration', { ...change, ...input('Conflict') }), 'already-exists');
  await denied(publicCall('updateEventRegistration', { ...managed(team), requestId: randomUUID(), ...input('Invalid', 99) }), 'invalid-argument');
  check((await list(team)).length === 3, 'Failed changes do not enqueue');
  console.log('PASS: real update, no-op, concurrent/delayed retry and failed update');

  phase = 'foreign management tokens';
  const other = await create('Jiný emailový tým');
  for (const [method, extra] of [['getEventRegistration', {}], ['updateEventRegistration', input('Forged')], ['cancelEventRegistration', {}]]) {
    await denied(publicCall(method, { ...managed(team), token: other.managementToken, ...extra }), 'not-found');
    await denied(publicCall(method, { ...managed(team), eventId: 'nonexistent-event', ...extra }), 'not-found');
  }
  check((await list(team)).length === 3 && (await list(other)).length === 1, 'No foreign-token email');
  console.log('PASS: cross-registration and cross-event tokens denied without messages');

  phase = 'lost provider response requires review without automatic resubmission';
  const otherConfirmation = (await list(other))[0];
  const priorCaptureCount = capture.messages.size;
  capture.nextFailure = 'after-accept';
  check(await fixture.deliver(otherConfirmation.ref) === 'failed', 'Lost response is terminal for automatic delivery');
  fixture.advance();
  check(await fixture.deliver(otherConfirmation.ref) === 'unchanged', 'Lost-response terminal replay does not send');
  check(capture.messages.size === priorCaptureCount + 1 && (await otherConfirmation.ref.get()).data().attempts === 1
    && (await otherConfirmation.ref.get()).data().lastError === 'outcome-unknown', 'One attempt and review-required audit');
  console.log('PASS: accepted email with lost response is terminal and never resubmitted automatically');

  phase = 'cancel transaction and older delivery status isolation';
  await Promise.all([publicCall('cancelEventRegistration', managed(team)), publicCall('cancelEventRegistration', managed(team))]);
  await publicCall('cancelEventRegistration', managed(team));
  const all = await list(team);
  check(all.length === 4 && all.filter(doc => doc.data().type === 'registration-cancelled').length === 1, 'Exactly one cancellation intent');
  const cancellation = all.find(doc => doc.data().type === 'registration-cancelled');
  check(cancellation.data().recipient === 'updated@example.test', 'Cancel recipient is current server email');
  const update = all.find(doc => doc.data().type === 'registration-updated');
  await fixture.deliver(update.ref);
  check(/Spravovat registraci: (\S+)/u.exec(capture.messages.get(update.ref.path).text)?.[1] === link.href, 'Update delivery reconstructs the original private CTA');
  // A different pending update reproduces a crashed processing claim, without
  // overwriting the already-delivered update's terminal audit.
  const crashedUpdate = all.find(doc => doc.data().type === 'registration-updated' && doc.id !== update.id);
  const timestamp = update.data().createdAt.constructor;
  await crashedUpdate.ref.update({ status: 'processing', leaseId: 'synthetic-crashed-worker', leaseUntil: timestamp.fromMillis(fixture.clock() + 60_000), attempts: 1 });
  check(await fixture.deliver(crashedUpdate.ref) === 'busy', 'Active crash lease blocks another worker');
  await crashedUpdate.ref.update({ leaseUntil: timestamp.fromMillis(fixture.clock() - 1) });
  const beforeCrash = capture.messages.size;
  check(await fixture.deliver(crashedUpdate.ref) === 'failed', 'Expired crash lease is terminal');
  check((await crashedUpdate.ref.get()).data().lastError === 'outcome-unknown' && (await crashedUpdate.ref.get()).data().attempts === 1
    && capture.messages.size === beforeCrash, 'Expired lease never attempts another physical send');
  check((await record(team)).emailDelivery.intentId === cancellation.id && (await record(team)).emailDelivery.status === 'pending', 'Older attempt cannot hide newer pending message');
  const parallel = await Promise.all([fixture.deliver(cancellation.ref), fixture.deliver(cancellation.ref)]);
  check(parallel.filter(result => result === 'sent').length === 1 && parallel.filter(result => result === 'busy' || result === 'unchanged').length === 1, 'Concurrent workers share lease');
  check(capture.messages.get(cancellation.ref.path).text.includes('Tým již není aktivně přihlášen'), 'Cancellation wording');
  const cancelledReplay = await create('Emailový tým', retryKey);
  check(cancelledReplay.registrationId === team.registrationId && cancelledReplay.status === 'cancelled' && (await list(team)).length === 4, 'Create retry after rename/cancel does not register again');
  console.log('PASS: idempotent self-cancel, authoritative recipient, concurrent worker lease and safe latest status');

  phase = 'manual and admin operations';
  const totalBeforeManual = (await eventRef.collection('emailIntents').get()).size;
  for (const email of [null, 'manual@example.test']) {
    const teamName = email ? 'Ruční s emailem' : 'Ruční bez emailu';
    const manual = await adminCall('adminAddEventTeam', { eventId, requestId: randomUUID(), teamName, memberCount: 4, contactEmail: email });
    await adminCall('adminUpdateEventTeam', { eventId, registrationId: manual.registrationId, expectedRevision: 1, teamName: teamName + ' upravený', memberCount: 3, contactEmail: email });
    await adminCall('adminCancelEventRegistration', { eventId, registrationId: manual.registrationId });
    check((await list(manual)).length === 0 && !(await record(manual)).emailDelivery, 'Manual team has no email status or intent');
  }
  await adminCall('adminCancelEventRegistration', { eventId, registrationId: other.registrationId });
  check((await eventRef.collection('emailIntents').get()).size === totalBeforeManual, 'No mail from admin changes');
  console.log('PASS: manual add/edit with and without email plus admin cancellation emit no email');

  phase = 'persistent audit and runtime logs';
  for (const collection of ['registrations', 'registrationOperations', 'emailIntents', 'emailSecrets']) {
    const serialized = JSON.stringify((await eventRef.collection(collection).get()).docs.map(doc => doc.data()));
    check(secrets.every(secret => !serialized.includes(secret)), 'No raw capabilities in persistent documents');
    check(!serialized.includes('#registration=') && !serialized.includes('Spravovat registraci:'), 'No secret URL/provider payload in audit');
  }
  for (const path of ['firebase-debug.log', 'firestore-debug.log', 'functions-debug.log']) if (existsSync(path)) {
    const log = readFileSync(path, 'utf8');
    check(secrets.every(secret => !log.includes(secret)), 'No management/retry capabilities in runtime logs');
  }
  console.log('PASS: ciphertext-only capability persistence, safe audit and runtime logs');
} catch {
  // Assertions/SDK exceptions must never print a captured message or bearer token.
  console.error(`FAIL: registration email contracts — ${phase}`);
  process.exitCode = 1;
} finally {
  if (fixture) await fixture.dispose();
}
