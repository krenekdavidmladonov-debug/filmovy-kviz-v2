import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword, updatePassword, signOut } from 'firebase/auth';
import { requireFullEmulatorEnvironment } from '../../tools/local-emulator-environment.mjs';
import { takeover, digest, ownerGrant, firestoreTakeoverStore } from '../../tools/access/owner-takeover-core.mjs';

const env = requireFullEmulatorEnvironment(process.env, 'Isolated operator takeover test');
const require = createRequire(new URL('../../functions/package.json', import.meta.url));
const admin = require('firebase-admin/app'), app = admin.initializeApp({ projectId: env.projectId });
const auth = require('firebase-admin/auth').getAuth(app), db = require('firebase-admin/firestore').getFirestore(app);
const { listAccessUsers } = await import('../../functions/lib/access/callables.js');
const { freshIdentity, authorize } = await import('../../functions/lib/access/authorization.js');
const prefix = `takeover-${randomUUID()}`, uid = `${prefix}-one`, email = `${uid}@example.invalid`;
const originalPassword = randomUUID(), personalPassword = randomUUID();
const client = initializeApp({ projectId: env.projectId, apiKey: 'demo-key' }, prefix), clientAuth = getAuth(client);
connectAuthEmulator(clientAuth, `http://${env.authEndpoint.host}:${env.authEndpoint.port}`, { disableWarnings: true });
const sentinel = `${prefix}-content`, operator = { provider: 'google-oauth', subject: 'synthetic-operator', email: 'operator@example.invalid', verified: true };
const docs = [`memberships/${uid}`, `quizzes/${sentinel}`, 'accessControl/state']; const users = [uid];
const authBase = `http://${env.authEndpoint.host}:${env.authEndpoint.port}/identitytoolkit.googleapis.com/v1/projects/${env.projectId}`;
const metadata = async target => {
  const response = await fetch(`${authBase}/accounts:lookup`, { method: 'POST', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, body: JSON.stringify({ localId: [target] }) });
  assert.equal(response.status, 200); const u = (await response.json()).users[0];
  return { uid: u.localId, email: u.email, emailVerified: u.emailVerified === true, disabled: u.disabled === true,
    providers: u.providerUserInfo.map(p => p.providerId), passwordUpdatedAt: Number(u.passwordUpdatedAt), validSince: Number(u.validSince),
    customAuth: false, emailLinkSignin: false, phoneLinked: false, tenantId: null };
};
const identity = token => ({ uid, token: JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()) });
const directRead = token => fetch(`http://${env.firestoreEndpoint.host}:${env.firestoreEndpoint.port}/v1/projects/${env.projectId}/databases/(default)/documents/quizzes/${sentinel}`, { headers: { Authorization: `Bearer ${token}` } });
try {
  await auth.createUser({ uid, email, password: originalPassword, emailVerified: true });
  const member = { ...ownerGrant, role: 'manager', uid, email, displayName: 'Synthetic manager', status: 'active', version: 1, sessionValidAfter: 0, unrelated: 'preserve' };
  await db.doc(`memberships/${uid}`).set(member); await db.doc('accessControl/state').set({ revision: 0, collaborationEnabled: true });
  await db.doc(`quizzes/${sentinel}`).set({ createdBy: uid, title: 'Synthetic sentinel', untouched: true });
  await signInWithEmailAndPassword(clientAuth, email, originalPassword); const oldToken = await clientAuth.currentUser.getIdToken();
  assert.equal((await directRead(oldToken)).status, 200); await listAccessUsers.run({ data: {}, auth: identity(oldToken) });
  const baseline = (await metadata(uid)).passwordUpdatedAt, observed = Date.now();
  await new Promise(resolve => setTimeout(resolve, 1100));
  await updatePassword(clientAuth.currentUser, personalPassword);
  const retirement = { retired: true, protectedUidDigest: digest(uid) };
  const approval = { mode: 'take-over-existing-staging-admin', projectId: env.projectId, targetUid: uid, targetEmail: email,
    expectedMembershipVersion: 1, expectedMembershipDigest: digest(member), passwordBaselineUpdatedAt: baseline, passwordObservedAt: observed,
    qaRetirementDigest: digest(retirement), approvalReference: `${prefix}-approved`, reason: 'Synthetic emulator takeover security contract' };
  const options = { approval, policy: { projectId: env.projectId, allowedUid: uid }, retirement, operator,
    auth: { lookup: () => metadata(uid), revoke: target => auth.revokeRefreshTokens(target) }, store: firestoreTakeoverStore(db, uid) };
  const plan = await takeover(options); assert.equal(plan.status, 'DRY_RUN_READY');
  assert.equal((await db.doc(`memberships/${uid}`).get()).data().role, 'manager');
  const result = await takeover({ ...options, apply: true, confirmPlanSha256: plan.planSha256 }); assert.equal(result.status, 'APPLIED');
  const audit = [`accessAudit/owner-takeover-cutoff-${result.operationId}`, `accessAudit/owner-takeover-complete-${result.operationId}`]; docs.push(...audit);
  const after = (await db.doc(`memberships/${uid}`).get()).data(); assert.equal(after.role, 'owner'); assert.equal(after.unrelated, 'preserve');
  assert.equal((await directRead(oldToken)).status, 403);
  await assert.rejects(() => listAccessUsers.run({ data: {}, auth: identity(oldToken) }));
  await assert.rejects(() => authorize(identity(oldToken), ['users.manage']));
  await signOut(clientAuth); await new Promise(resolve => setTimeout(resolve, 1100));
  await assert.rejects(() => signInWithEmailAndPassword(clientAuth, email, originalPassword));
  await signInWithEmailAndPassword(clientAuth, email, personalPassword); const freshToken = await clientAuth.currentUser.getIdToken();
  await freshIdentity(identity(freshToken)); assert.equal((await authorize(identity(freshToken), ['users.manage'])).role, 'owner');
  await listAccessUsers.run({ data: {}, auth: identity(freshToken) }); assert.equal((await directRead(freshToken)).status, 200);
  assert.deepEqual((await db.doc(`quizzes/${sentinel}`).get()).data(), { createdBy: uid, title: 'Synthetic sentinel', untouched: true });
  const auditTimes = await Promise.all(audit.map(async path => (await db.doc(path).get()).updateTime.toMillis()));
  assert.equal((await takeover({ ...options, apply: true })).status, 'NO_OP');
  assert.deepEqual(await Promise.all(audit.map(async path => (await db.doc(path).get()).updateTime.toMillis())), auditTimes);
  console.log('PASS real synthetic password rotation; captured old token denied by existing server authorization AND direct Firestore Rules after owner promotion; fresh password login works; completed repeat has unchanged audits.');

  // Exercise real Firestore query/control conflicts, using two synthetic contenders.
  await db.doc(`memberships/${uid}`).delete();
  const contenders = [];
  for (const name of ['two', 'three']) {
    const candidate = `${prefix}-${name}`, candidateEmail = `${candidate}@example.invalid`; users.push(candidate); docs.push(`memberships/${candidate}`);
    await auth.createUser({ uid: candidate, email: candidateEmail, password: randomUUID(), emailVerified: true });
    const m = { ...member, uid: candidate, email: candidateEmail }; await db.doc(`memberships/${candidate}`).set(m);
    const info = await metadata(candidate), retired = { retired: true, protectedUidDigest: digest(candidate) };
    const a = { ...approval, targetUid: candidate, targetEmail: candidateEmail, expectedMembershipDigest: digest(m), passwordBaselineUpdatedAt: info.passwordUpdatedAt - 2000,
      passwordObservedAt: info.passwordUpdatedAt - 1000, qaRetirementDigest: digest(retired), approvalReference: `${prefix}-${name}-approved` };
    const o = { ...options, approval: a, policy: { projectId: env.projectId, allowedUid: candidate }, retirement: retired,
      auth: { lookup: () => metadata(candidate), revoke: target => auth.revokeRefreshTokens(target) }, store: firestoreTakeoverStore(db, candidate) };
    const p = await takeover(o); contenders.push({ ...o, apply: true, confirmPlanSha256: p.planSha256 });
    docs.push(`accessAudit/owner-takeover-cutoff-${p.plan.operationId}`, `accessAudit/owner-takeover-complete-${p.plan.operationId}`);
  }
  const results = await Promise.allSettled(contenders.map(o => takeover(o)));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal((await db.collection('memberships').where('role', '==', 'owner').get()).size, 1);
  console.log('PASS competing first-owner operations serialize through real Firestore transactions; exactly one owner.');
} finally {
  await signOut(clientAuth).catch(() => {}); await deleteApp(client);
  for (const path of docs) await db.doc(path).delete();
  for (const user of users) await auth.deleteUser(user);
  await admin.deleteApp(app);
}
