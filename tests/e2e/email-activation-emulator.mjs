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
} catch {
  console.error('FAIL: email activation transaction contracts — ' + phase);
  process.exitCode = 1;
} finally {
  if (fixture) await fixture.dispose();
}
