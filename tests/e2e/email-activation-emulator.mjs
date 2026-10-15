import { strict as assert } from 'node:assert';
import { randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { emailFixture } from './registration-email-fixture.mjs';
import { allowedRegistrationEmailIntent } from '../../functions/lib/email/runtime.js';
import { processEmailTask } from '../../functions/lib/email/task.js';

let fixture, phase = 'setup';
try {
  fixture = await emailFixture();
  const { Timestamp } = createRequire(new URL('../../functions/package.json', import.meta.url))('firebase-admin/firestore');
  const activation = { activatedAtMillis: fixture.clock() - 60_000, recipient: 'allowed@example.test' };
  const create = async recipient => {
    const team = await fixture.publicCall('createEventRegistration', { eventId: fixture.eventId,
      teamName: 'Activation ' + randomUUID(), memberCount: 2, contactEmail: recipient,
      requestKey: randomBytes(32).toString('base64url') });
    const [intent] = await fixture.intents(team.registrationId);
    return { team, ref: intent.ref };
  };
  const state = async ({ team, ref }) => {
    const docs = await Promise.all([ref.get(), fixture.eventRef.collection('registrations').doc(team.registrationId).get()]);
    return docs.map(doc => ({ data: doc.data(), updateTime: [doc.updateTime.seconds, doc.updateTime.nanoseconds] }));
  };
  let secretResolutions = 0, providerCalls = 0;
  const task = async record => processEmailTask({ eventId: fixture.eventId, intentId: record.ref.id }, {
    db: fixture.db, clock: fixture.clock,
    allowIntent: intent => allowedRegistrationEmailIntent(intent, activation),
    transport: () => { secretResolutions++; return { send: message => { providerCalls++; return fixture.capture.send(message); } }; },
    vault: () => { secretResolutions++; return fixture.vault; }, origin: 'http://127.0.0.1:5196',
  });
  phase = 'another recipient has no lease, status write or secret resolution';
  const other = await create('other@example.test'), beforeOther = await state(other);
  await task(other); assert.deepEqual(await state(other), beforeOther);
  assert.equal(secretResolutions, 0); assert.equal(providerCalls, 0);

  phase = 'pre-cutoff registration remains untouched';
  const old = await create(activation.recipient);
  await old.ref.update({ createdAt: Timestamp.fromMillis(activation.activatedAtMillis - 1) });
  const beforeOld = await state(old);
  await task(old); assert.deepEqual(await state(old), beforeOld);
  assert.equal(secretResolutions, 0); assert.equal(providerCalls, 0);

  phase = 'team-message task remains untouched even for the allowed recipient';
  const teamMessage = await create(activation.recipient);
  await teamMessage.ref.update({ type: 'event-team-message', campaignId: 'a'.repeat(64) });
  const beforeTeamMessage = await state(teamMessage);
  await task(teamMessage); assert.deepEqual(await state(teamMessage), beforeTeamMessage);
  assert.equal(secretResolutions, 0); assert.equal(providerCalls, 0);
  console.log('PASS: actual transaction rejects other-recipient, old and team intents without writes or provider/secret access');

  phase = 'new allowed registration sends once and terminal task replay is unchanged';
  const allowed = await create(activation.recipient);
  await task(allowed);
  assert.equal((await allowed.ref.get()).data().status, 'sent');
  assert.equal(providerCalls, 1); assert.equal(fixture.capture.messages.size, 1);
  assert.equal(fixture.capture.messages.get(allowed.ref.path).to, activation.recipient);
  const accepted = await state(allowed), resolutionsAfterSend = secretResolutions;
  await task(allowed); assert.deepEqual(await state(allowed), accepted);
  assert.equal(providerCalls, 1); assert.equal(secretResolutions, resolutionsAfterSend);
  console.log('PASS: allowed current registration uses fake delivery once; terminal replay performs no write or provider access');

  // Cloud opt-in remains forbidden in demo runtimes. Exercise its exact shared
  // lease filter against real emulator transactions, using canonical registration
  // timestamps as server fixture provenance. Handler provenance is tested in
  // emailActivation.test.ts; this does not change any emulator/cloud env guard.
  const future = { activatedAtMillis: activation.activatedAtMillis, recipientPolicy: 'future-public-registration' };
  const futureTask = record => processEmailTask({ eventId: fixture.eventId, intentId: record.ref.id }, {
    db: fixture.db, clock: fixture.clock, allowIntent: intent => allowedRegistrationEmailIntent(intent, future),
    transport: () => { secretResolutions++; return { send: message => { providerCalls++; return fixture.capture.send(message); } }; },
    vault: () => { secretResolutions++; return fixture.vault; }, origin: 'http://127.0.0.1:5196',
  });
  phase = 'future policy does not send unmarked historical backlog or fresh changes of old registrations';
  const beforeBacklog = await state(other), beforeResolutions = secretResolutions;
  await futureTask(other); assert.deepEqual(await state(other), beforeBacklog);
  const forgedTeam = await fixture.publicCall('createEventRegistration', { eventId: fixture.eventId, teamName: 'Forged marker ' + randomUUID(), memberCount: 2,
    contactEmail: 'client-marker@example.test', requestKey: randomBytes(32).toString('base64url'), recipientPolicy: future.recipientPolicy,
    registrationCreatedAt: new Date().toISOString(), createdAt: '2031-01-01T00:00:00.000Z', source: 'manual' });
  const [forgedIntent] = await fixture.intents(forgedTeam.registrationId);
  assert.equal(forgedIntent.data().recipientPolicy, undefined); assert.equal(forgedIntent.data().registrationCreatedAt, undefined);
  const forged = { team: forgedTeam, ref: forgedIntent.ref }, beforeForged = await state(forged);
  await futureTask(forged); assert.deepEqual(await state(forged), beforeForged);
  const oldChange = await create('old-changed@example.test');
  await oldChange.ref.update({ recipientPolicy: future.recipientPolicy, type: 'registration-updated', registrationCreatedAt: Timestamp.fromMillis(future.activatedAtMillis - 1) });
  const beforeOldChange = await state(oldChange); await futureTask(oldChange); assert.deepEqual(await state(oldChange), beforeOldChange);
  assert.equal(providerCalls, 1); assert.equal(secretResolutions, beforeResolutions);
  console.log('PASS: future policy leaves unmarked backlog, client-forged marker and old-registration updates untouched before lease/secrets/provider');

  phase = 'future public confirmation, update and cancellation deliver through the same private fake worker';
  const newTeam = await create('future-public@example.test');
  const registrationRef = fixture.eventRef.collection('registrations').doc(newTeam.team.registrationId);
  const registration = (await registrationRef.get()).data();
  const provenance = { recipientPolicy: future.recipientPolicy, registrationCreatedAt: registration.createdAt };
  await newTeam.ref.update(provenance); await futureTask(newTeam);
  assert.equal((await newTeam.ref.get()).data().status, 'sent');
  const managed = { eventId: fixture.eventId, registrationId: newTeam.team.registrationId, token: newTeam.team.managementToken };
  const changed = { ...managed, requestId: randomUUID(), teamName: 'Future changed ' + randomUUID(), memberCount: 3, contactEmail: 'future-updated@example.test' };
  await fixture.publicCall('updateEventRegistration', changed);
  const update = (await fixture.intents(newTeam.team.registrationId)).find(doc => doc.data().type === 'registration-updated');
  await update.ref.update(provenance); await futureTask({ team: newTeam.team, ref: update.ref });
  await fixture.publicCall('updateEventRegistration', changed);
  assert.equal((await fixture.intents(newTeam.team.registrationId)).length, 2);
  await fixture.publicCall('cancelEventRegistration', managed);
  const cancellation = (await fixture.intents(newTeam.team.registrationId)).find(doc => doc.data().type === 'registration-cancelled');
  await cancellation.ref.update(provenance); await futureTask({ team: newTeam.team, ref: cancellation.ref });
  await fixture.publicCall('cancelEventRegistration', managed);
  assert.equal((await fixture.intents(newTeam.team.registrationId)).length, 3);
  assert.equal(providerCalls, 4);
  assert((await fixture.intents(newTeam.team.registrationId)).every(doc => doc.data().status === 'sent'));
  const beforeReplay = await state(newTeam), beforeTerminalSecrets = secretResolutions;
  await futureTask(newTeam); assert.deepEqual(await state(newTeam), beforeReplay); assert.equal(secretResolutions, beforeTerminalSecrets); assert.equal(providerCalls, 4);
  console.log('PASS: future confirmation/update/cancel fake delivery, current recipient snapshots, idempotent operations and terminal no-send replay');
} catch {
  console.error('FAIL: email activation transaction contracts — ' + phase);
  process.exitCode = 1;
} finally {
  if (fixture) await fixture.dispose();
}
