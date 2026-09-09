import { strict as assert } from 'node:assert';
import { randomBytes, randomUUID } from 'node:crypto';
import { emailFixture } from './registration-email-fixture.mjs';
import { processEmailTask } from '../../functions/lib/email/task.js';
import { EmailDeliveryError } from '../../functions/lib/email/errors.js';
import { MAX_EMAIL_ATTEMPTS } from '../../functions/lib/email/delivery.js';

let fixture;
let phase = 'setup';
const check = (condition, label) => assert.ok(condition, label);
try {
  fixture = await emailFixture({ gmail: true });
  const { eventRef, eventId, capture, publicCall } = fixture;
  const input = name => ({ teamName: name, memberCount: 3, contactEmail: 'gmail-team@example.test' });
  const create = async name => {
    const team = await publicCall('createEventRegistration', { eventId, requestKey: randomBytes(32).toString('base64url'), ...input(name) });
    const intent = (await fixture.intents(team.registrationId))[0];
    return { team, ref: intent.ref };
  };
  const task = ref => fixture.deliverTask(ref);
  const data = async ref => (await ref.get()).data();
  const retry = promise => assert.rejects(promise, error => error instanceof EmailDeliveryError && error.retryable);
  phase = 'registration, update and cancellation through Gmail task';
  const { team, ref } = await create('Gmail průchod');
  await task(ref); await task(ref);
  const managed = { eventId, registrationId: team.registrationId, token: team.managementToken };
  await publicCall('updateEventRegistration', { ...managed, requestId: randomUUID(), ...input('Gmail změna') });
  const update = (await fixture.intents(team.registrationId)).find(doc => doc.data().type === 'registration-updated');
  await task(update.ref);
  await publicCall('cancelEventRegistration', managed);
  const cancel = (await fixture.intents(team.registrationId)).find(doc => doc.data().type === 'registration-cancelled');
  await task(cancel.ref);
  check(capture.submissions.length === 3 && (await data(ref)).status === 'sent' && (await data(cancel.ref)).status === 'sent', phase);
  check(Buffer.from(capture.submissions[0], 'base64url').toString().includes('Content-Type: multipart/alternative'), 'Actual MIME path');
  console.log('PASS: registration/update/cancel through shared task and fake Gmail MIME, terminal task replay');

  phase = 'transient retry with backoff';
  const transient = await create('Gmail přechodná');
  capture.nextFailure = 'rate-limit';
  await retry(task(transient.ref));
  check((await data(transient.ref)).status === 'pending' && (await data(transient.ref)).attempts === 1, phase);
  await retry(task(transient.ref));
  check((await data(transient.ref)).attempts === 1, 'Early retry does not consume send attempt');
  fixture.advance(); await task(transient.ref);
  check((await data(transient.ref)).status === 'sent' && (await data(transient.ref)).attempts === 2, phase);
  console.log('PASS: transient failure, persisted backoff, early task retry and eventual acceptance');

  phase = 'permanent credentials failure';
  const permanent = await create('Gmail neplatné oprávnění');
  capture.nextFailure = 'invalid-grant';
  await task(permanent.ref); await task(permanent.ref);
  check((await data(permanent.ref)).status === 'failed' && (await data(permanent.ref)).attempts === 1 && (await data(permanent.ref)).lastError === 'credentials-invalid', phase);
  console.log('PASS: invalid_grant is terminal, queue replay cannot resend');

  phase = 'unknown outcome has stable ID but possible duplicate';
  const unknown = await create('Gmail ztracená odpověď');
  const beforeUnknown = capture.submissions.length;
  capture.nextFailure = 'after-accept';
  await retry(task(unknown.ref));
  fixture.advance(); await task(unknown.ref);
  check(capture.submissions.length === beforeUnknown + 2, 'Fake must not invent Gmail deduplication');
  check(capture.submissions[beforeUnknown] === capture.submissions[beforeUnknown + 1], 'Stable MIME Message-ID across retry');
  console.log('PASS: lost Gmail response demonstrates duplicate submissions with stable RFC Message-ID');

  phase = 'concurrent workers and processing status';
  const concurrent = await create('Gmail souběh');
  let release, started;
  const entered = new Promise(resolve => { started = resolve; });
  const blocked = new Promise(resolve => { release = resolve; });
  const slow = { send: async message => { started(); await blocked; await capture.send(message); } };
  const first = processEmailTask({ eventId, intentId: concurrent.ref.id }, { db: fixture.db, transport: slow, vault: fixture.vault, origin: 'http://127.0.0.1:5196', clock: fixture.clock });
  await entered;
  check((await data(concurrent.ref)).status === 'processing', phase);
  await retry(task(concurrent.ref));
  release(); await first;
  check((await data(concurrent.ref)).attempts === 1 && (await data(concurrent.ref)).status === 'sent', phase);
  const [differentA, differentB] = await Promise.all([create('Paralelní A'), create('Paralelní B')]);
  await Promise.all([task(differentA.ref), task(differentB.ref)]);
  check(capture.messages.get(differentA.ref.path).text.includes('Paralelní A') && capture.messages.get(differentB.ref.path).text.includes('Paralelní B'), 'Independent concurrent intents');
  console.log('PASS: active lease retries, processing status and concurrent distinct intents remain isolated');

  phase = 'maximum provider attempts and crash recovery';
  const exhausted = await create('Gmail maximum');
  for (let attempt = 1; attempt <= MAX_EMAIL_ATTEMPTS; attempt++) {
    capture.nextFailure = 'before-accept';
    if (attempt < MAX_EMAIL_ATTEMPTS) await retry(task(exhausted.ref)); else await task(exhausted.ref);
    fixture.advance();
  }
  await task(exhausted.ref);
  check((await data(exhausted.ref)).attempts === MAX_EMAIL_ATTEMPTS && (await data(exhausted.ref)).status === 'failed', phase);
  const crashed = await create('Gmail poslední crash');
  const Timestamp = (await data(crashed.ref)).createdAt.constructor;
  await crashed.ref.update({ status: 'processing', attempts: MAX_EMAIL_ATTEMPTS, leaseId: 'synthetic-crash', leaseUntil: Timestamp.fromMillis(fixture.clock() - 1) });
  const beforeCrash = capture.submissions.length;
  await task(crashed.ref);
  check((await data(crashed.ref)).status === 'failed' && capture.submissions.length === beforeCrash, 'Crash exhausted attempt terminalizes without send');
  console.log('PASS: max attempts and last-attempt crash terminalization prevent unbounded sends');

  phase = 'missing vault and malformed binding fail closed';
  const missing = await create('Gmail bez klíče');
  const beforeMissing = capture.submissions.length;
  await processEmailTask({ eventId, intentId: missing.ref.id }, { db: fixture.db, transport: capture,
    vault: () => { throw new EmailDeliveryError('configuration-invalid', false); }, origin: 'http://127.0.0.1:5196', clock: fixture.clock });
  check((await data(missing.ref)).status === 'failed' && capture.submissions.length === beforeMissing, phase);
  const foreign = await create('Gmail cizí binding');
  await foreign.ref.update({ eventId: 'foreign-event' });
  await task(foreign.ref);
  check((await data(foreign.ref)).status === 'failed' && capture.submissions.length === beforeMissing, phase);
  const persisted = JSON.stringify((await eventRef.collection('emailIntents').get()).docs.map(doc => doc.data()));
  check(!persisted.includes(team.managementToken) && !persisted.includes('Bearer ') && !persisted.includes('#registration='), 'No plaintext/provider data in audit');
  console.log('PASS: missing vault, foreign intent binding and plaintext/provider audit exclusion');
} catch {
  console.error('FAIL: Gmail delivery contracts — ' + phase);
  process.exitCode = 1;
} finally { if (fixture) await fixture.dispose(); }
