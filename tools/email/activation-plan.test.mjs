import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { preparePlan, savePlans, localPath, ownerSelection, TARGETS, PROJECT, ORIGIN } from './activation-plan.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const parent = path.join(root, '.local-data/email-activation-tests'); mkdirSync(parent, { recursive: true });
const input = () => ({ sourceSha: 'a'.repeat(40), projectId: PROJECT, region: 'europe-west1', publicOrigin: ORIGIN, mode: 'staging', activatedAt: null });
const selection = { senderEmail: 'sender@example.test', recipientEmail: 'recipient@example.test' };
const draft = () => ({ schemaVersion: 1, status: 'DRAFT_OWNER_SELECTION', recordedAt: '2031-01-01T00:00:00.000Z', source: 'Synthetic owner selection', temporary: true, dedicatedMailboxPlanned: false, requestedSenderEmail: selection.senderEmail, verificationRecipientEmail: selection.recipientEmail, interpretation: 'Preparation only', currentTransport: 'disabled', senderAuthorizationVerified: false, providerConnectionConfigured: false, deliveryEnabled: false, containsCredentials: false });
test('existing closed owner draft schema converts only selected mailboxes without copying personal notes', () => {
  assert.deepEqual(ownerSelection(draft()), selection);
  for (const patch of [{ refreshToken: 'synthetic' }, { senderAuthorizationVerified: true }, { providerConnectionConfigured: true }, { deliveryEnabled: true }, { containsCredentials: true }, { status: 'VERIFIED' }]) assert.throws(() => ownerSelection({ ...draft(), ...patch }));
});
test('structural preparation works without credentials/OAuth and stays blocked', () => {
  const { publicPlan: p } = preparePlan(input());
  assert.equal(p.mode, 'PREPARATION_ONLY'); assert.equal(p.deployAuthorized, false); assert.equal(p.sendAuthorized, false);
  assert.equal(p.cloudInventoryVerified, false); assert(p.blockers.includes('HUMAN_OAUTH_SEND_ONLY_NOT_VERIFIED'));
  assert(p.blockers.includes('ACTIVATION_CUTOFF_UNSET')); assert.deepEqual(p.targets, TARGETS);
  assert.equal(p.changes.deliverEmailTask.publicInvokerAllowed, false);
  assert.deepEqual(p.changes.createEventRegistration.secrets, ['EMAIL_TOKEN_KEYRING']);
});
test('foreign project/origin/region/mode and missing source rejected', () => {
  for (const patch of [{ projectId: 'production' }, { publicOrigin: 'https://foreign.example.test' }, { region: 'us-central1' }, { mode: 'off' }, { sourceSha: '' }]) assert.throws(() => preparePlan({ ...input(), ...patch }));
});
test('incomplete or extra fields cannot smuggle credentials/public worker/team scope', () => {
  const missing = input(); delete missing.mode; assert.throws(() => preparePlan(missing));
  for (const patch of [{ refreshToken: 'synthetic' }, { clientSecret: 'synthetic' }, { targets: ['createEventTeamMessage'] }, { publicInvokerAllowed: true }, { oauthVerified: true }]) assert.throws(() => preparePlan({ ...input(), ...patch }));
});
test('cutoff must be exact UTC and does not imply approved execution', () => {
  for (const activatedAt of ['', 'tomorrow', '2031-01-01T00:00:00+01:00', '2031-02-30T00:00:00.000Z', '+010000-01-01T00:00:00.000Z']) assert.throws(() => preparePlan({ ...input(), activatedAt }));
  const { publicPlan: p } = preparePlan({ ...input(), activatedAt: '2031-01-01T00:00:00.000Z' }, selection);
  assert(!p.blockers.includes('ACTIVATION_CUTOFF_UNSET')); assert(p.blockers.includes('DEPLOYMENT_AND_ONE_RECIPIENT_SEND_APPROVAL_NOT_VERIFIED'));
});
test('mailbox selection is strict and public plan contains no actual addresses', () => {
  for (const s of [{ ...selection, token: 'synthetic' }, { recipientEmail: selection.recipientEmail }, { ...selection, recipientEmail: 'a@example.test,b@example.test' }, { ...selection, senderEmail: 'Name <a@example.test>' }]) assert.throws(() => preparePlan(input(), s));
  for (const invalid of ['.a@example.test', 'a..b@example.test', 'a@bad-.test', `${'a'.repeat(65)}@example.test`]) {
    for (const field of ['senderEmail', 'recipientEmail']) assert.throws(() => preparePlan(input(), { ...selection, [field]: invalid }), /MAILBOX_SELECTION_INVALID/u);
    for (const field of ['requestedSenderEmail', 'verificationRecipientEmail']) assert.throws(() => ownerSelection({ ...draft(), [field]: invalid }), /MAILBOX_SELECTION_INVALID/u);
  }
  const p = preparePlan(input(), selection); assert.deepEqual(p.privateSelection, selection);
  assert(!JSON.stringify(p.publicPlan).includes('@'));
});
test('private wx output is bound by hash; repeated preparation never overwrites', () => {
  const dir = mkdtempSync(path.join(parent, 'owned-')), result = savePlans(dir, preparePlan(input(), selection));
  const publicBytes = readFileSync(path.join(dir, 'activation-plan.json')), privateBytes = readFileSync(path.join(dir, 'activation-plan-private.json'));
  assert(!publicBytes.includes(Buffer.from(selection.recipientEmail))); assert(privateBytes.includes(Buffer.from(selection.recipientEmail)));
  assert.equal(result.cloudWrites, 0); assert.match(JSON.parse(publicBytes).privateSelectionFileSha256, /^[a-f0-9]{64}$/u);
  assert.throws(() => savePlans(dir, preparePlan(input(), selection)), /OUTPUT_ALREADY_EXISTS/u);
  assert.deepEqual(readFileSync(path.join(dir, 'activation-plan-private.json')), privateBytes);
});
test('outside local data, credential filenames and linked directories rejected', () => {
  assert.throws(() => localPath(path.join(root, 'package.json')));
  const dir = mkdtempSync(path.join(parent, 'paths-')), credentials = path.join(dir, 'credentials.json'); writeFileSync(credentials, '{}');
  assert.throws(() => localPath(credentials), /CREDENTIAL_PATH_REFUSED/u);
  const linked = path.join(dir, 'linked'); symlinkSync(dir, linked, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => localPath(linked, { directory: true }));
});
