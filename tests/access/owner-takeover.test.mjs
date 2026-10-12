import assert from 'node:assert/strict';
import { test } from 'node:test';
import { takeover, digest, ownerGrant, validateApproval } from '../../tools/access/owner-takeover-core.mjs';
import { assertIsolatedQaManifest } from '../../tools/staging/qa-identity-guard.mjs';
import { legacyStagingAccounts } from '../../tools/access/legacy-staging-accounts.mjs';

const NOW = 1_800_000_000_000;
function database() {
  const data = { members: new Map(), audits: new Map(), control: { revision: 4, collaborationEnabled: true }, writes: 0 };
  let serial = Promise.resolve();
  const store = uid => {
    const state = op => structuredClone({ member: data.members.get(uid), owners: [...data.members.values()].filter(m => m.role === 'owner'),
      control: data.control, started: data.audits.get(`start:${op}`), finished: data.audits.get(`finish:${op}`) });
    return { read: async op => state(op), transact: (op, callback) => {
      const next = serial.then(() => {
        const change = callback(state(op));
        if (change.stage) {
          const key = `${change.stage === 'cutoff' ? 'start' : 'finish'}:${op}`;
          assert.ok(!data.audits.has(key));
          data.members.set(uid, { ...data.members.get(uid), ...structuredClone(change.memberPatch) });
          data.audits.set(key, structuredClone(change.audit)); data.control.revision++; data.writes++;
        }
        return change.result;
      }); serial = next.catch(() => {}); return next;
    } };
  };
  return { data, store };
}
function fixture(shared = database(), uid = 'synthetic-takeover-manager') {
  const member = { ...structuredClone(ownerGrant), role: 'manager', uid, status: 'active', version: 3, sessionValidAfter: 0,
    email: 'old-synthetic@example.invalid', displayName: 'Synthetic only', unrelated: { keep: true } };
  shared.data.members.set(uid, member);
  const policy = { projectId: 'filmovy-kviz-v2-staging', allowedUid: uid };
  const retirement = { retired: true, protectedUidDigest: digest(uid) };
  const approval = { mode: 'take-over-existing-staging-admin', projectId: policy.projectId, targetUid: uid, targetEmail: `${uid}@example.invalid`,
    expectedMembershipVersion: 3, expectedMembershipDigest: digest(member), passwordBaselineUpdatedAt: NOW - 86_400_000,
    passwordObservedAt: NOW - 3_600_000, qaRetirementDigest: digest(retirement), approvalReference: `private-test-approval-${uid}`, reason: 'Explicit synthetic test takeover only' };
  const user = { uid, email: approval.targetEmail, emailVerified: true, disabled: false, providers: ['password'], passwordUpdatedAt: NOW - 60_000,
    validSince: 0, customAuth: false, emailLinkSignin: false, phoneLinked: false, tenantId: null };
  const auth = { calls: 0, fail: false, lookup: async () => structuredClone(user), revoke: async target => {
    assert.equal(target, uid); auth.calls++; if (auth.fail) throw Error('Injected network failure'); user.validSince = NOW / 1000;
  } };
  const options = { approval, policy, retirement, auth, store: shared.store(uid), operator: { provider: 'google-oauth', subject: 'synthetic-operator', email: 'operator@example.invalid', verified: true }, now: () => NOW };
  return { ...shared, uid, user, auth, approval, options, run: extra => takeover({ ...options, ...extra }) };
}
async function apply(f) { const plan = await f.run(); return f.run({ apply: true, confirmPlanSha256: plan.planSha256 }); }

test('exact approved manager: dry-run does not write; apply preserves profile, scopes and unrelated records', async () => {
  const f = fixture(); f.data.members.set('other-synthetic', { uid: 'other-synthetic', role: 'moderator' });
  const before = structuredClone(f.data.members.get(f.uid));
  const plan = await f.run(); assert.equal(plan.status, 'DRY_RUN_READY'); assert.equal(f.data.writes, 0); assert.equal(f.auth.calls, 0);
  const result = await f.run({ apply: true, confirmPlanSha256: plan.planSha256 }); assert.equal(result.status, 'APPLIED');
  assert.deepEqual(f.data.members.get(f.uid), { ...before, ...ownerGrant, version: 5, sessionValidAfter: NOW / 1000 });
  assert.deepEqual(f.data.members.get('other-synthetic'), { uid: 'other-synthetic', role: 'moderator' });
  assert.equal(f.data.audits.size, 2); assert.equal(f.data.control.collaborationEnabled, true);
  const completed = [...f.data.audits.values()].find(a => a.kind === 'approved-owner-bootstrap');
  assert.equal(completed.actorUid, 'google-oauth:synthetic-operator'); assert.equal(completed.actorType, 'operator');
});
for (const [name, mutate] of [
  ['no explicit exception', f => { f.approval.mode = 'normal'; }],
  ['wrong approved UID', f => { f.approval.targetUid = 'different-synthetic'; }],
  ['different Auth UID', f => { f.user.uid = 'different-synthetic'; }],
  ['different email', f => { f.user.email = 'different@example.invalid'; }],
  ['mixed-case synthetic email', f => { f.approval.targetEmail = 'synthetic@example.TEST'; }],
  ['different project', f => { f.approval.projectId = 'demo-other'; }],
  ['unverified', f => { f.user.emailVerified = false; }],
  ['disabled', f => { f.user.disabled = true; }],
  ['linked login route', f => { f.user.providers.push('google.com'); }],
  ['custom login route', f => { f.user.customAuth = true; }],
  ['email link route', f => { f.user.emailLinkSignin = true; }],
  ['QA retirement incomplete', f => { f.options.retirement.retired = false; }],
  ['manager changed', f => { f.data.members.get(f.uid).version++; }],
  ['suspended manager', f => { f.data.members.get(f.uid).status = 'suspended'; }],
  ['another owner', f => { f.data.members.set('owner', { uid: 'owner', role: 'owner', status: 'active' }); }],
]) test(`${name}: rejected without writes`, async () => {
  const f = fixture(); mutate(f); await assert.rejects(() => f.run()); assert.equal(f.data.writes, 0); assert.equal(f.auth.calls, 0);
});
test('unchanged password returns waiting plan and apply is denied', async () => {
  const f = fixture(); f.user.passwordUpdatedAt = f.approval.passwordBaselineUpdatedAt;
  const plan = await f.run(); assert.equal(plan.status, 'WAITING_FOR_PASSWORD_CHANGE');
  await assert.rejects(() => f.run({ apply: true, confirmPlanSha256: plan.planSha256 }), /password/u);
  assert.equal(f.data.writes, 0); assert.equal(f.auth.calls, 0);
});
test('wrong confirmation hash cannot revoke sessions or promote', async () => {
  const f = fixture(); await assert.rejects(() => f.run({ apply: true, confirmPlanSha256: 'bad' }), /hash/u); assert.equal(f.data.writes, 0);
});
test('Auth failure leaves manager with cutoff; same operation resumes safely', async () => {
  const f = fixture(), plan = await f.run(); f.auth.fail = true;
  await assert.rejects(() => f.run({ apply: true, confirmPlanSha256: plan.planSha256 }), /OWNER_UNCHANGED/u);
  assert.equal(f.data.members.get(f.uid).role, 'manager'); assert.equal(f.data.audits.size, 1);
  assert.equal(f.data.members.get(f.uid).sessionValidAfter, NOW / 1000);
  f.auth.fail = false; assert.equal((await f.run()).planSha256, plan.planSha256);
  assert.equal((await f.run({ apply: true, confirmPlanSha256: plan.planSha256 })).status, 'APPLIED');
});
test('completed repeat is a no-op: no further revocation, write or duplicate audit', async () => {
  const f = fixture(); await apply(f); const before = { writes: f.data.writes, calls: f.auth.calls, audits: f.data.audits.size };
  assert.equal((await f.run({ apply: true })).status, 'NO_OP');
  assert.deepEqual({ writes: f.data.writes, calls: f.auth.calls, audits: f.data.audits.size }, before);
});
test('same-operation concurrency reports any Auth revocation actually attempted', async () => {
  const f = fixture(), plan = await f.run();
  const results = await Promise.all([f.run({ apply: true, confirmPlanSha256: plan.planSha256 }), f.run({ apply: true, confirmPlanSha256: plan.planSha256 })]);
  assert.equal(results.filter(r => r.status === 'APPLIED').length, 1);
  assert.equal(f.data.audits.size, 2);
  assert.equal(results.filter(r => r.authRevocationAttempted).length, f.auth.calls);
});
test('two competing first-owner operations cannot create two owners', async () => {
  const shared = database(), one = fixture(shared, 'synthetic-one'), two = fixture(shared, 'synthetic-two');
  const [p1, p2] = await Promise.all([one.run(), two.run()]);
  const results = await Promise.allSettled([one.run({ apply: true, confirmPlanSha256: p1.planSha256 }), two.run({ apply: true, confirmPlanSha256: p2.planSha256 })]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal([...shared.data.members.values()].filter(m => m.role === 'owner').length, 1);
  assert.equal([...shared.data.audits.values()].filter(a => a.kind === 'approved-owner-bootstrap').length, 1);
});
test('legacy denylist remains outside exception; production policy rejects synthetic target', () => {
  const f = fixture(); assert.throws(() => validateApproval(f.approval, { ...f.options.policy, allowedUid: legacyStagingAccounts.admin }));
});
test('QA requires isolated run-owned identities and rejects missing, retired and protected identities', () => {
  const run = 'staging-qa-abcdefghijkl', uid = `${run}-admin`;
  const manifest = { project: 'filmovy-kviz-v2-staging', qaRunId: run, users: { admin: { uid, email: `${uid}@example.test`, password: 'synthetic-only-test-password' } } };
  assert.doesNotThrow(() => assertIsolatedQaManifest(manifest));
  for (const patch of [{ uid: undefined }, { uid: legacyStagingAccounts.admin }, { retired: true }, { email: 'personal@example.invalid' }]) {
    assert.throws(() => assertIsolatedQaManifest({ ...manifest, users: { admin: { ...manifest.users.admin, ...patch } } }));
  }
  assert.throws(() => assertIsolatedQaManifest({ ...manifest, qaRunId: undefined }));
});
