import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { permissions } from '../../packages/quiz-domain/lib/access.js';

// Operator CLI only. This file is never exported by deployed Functions.
// Default is a read-only plan; identity approval is a local review artifact, never guessed.
const args = process.argv.slice(2), value = key => args[args.indexOf(key) + 1];
const allowed = new Set(['--approval', '--apply', '--confirm-plan-sha256']);
for (let i = 0; i < args.length; i++) {
  if (!allowed.has(args[i])) throw new Error('Unknown option.');
  if (args[i] !== '--apply') { if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error('Missing option value.'); i++; }
}
if (!args.includes('--approval')) throw new Error('Provide a reviewed local --approval JSON. Default action is dry-run.');
const approval = JSON.parse(await readFile(value('--approval'), 'utf8'));
const fields = ['projectId', 'targetUid', 'targetEmail', 'expectedMembershipVersion', 'approvalReference', 'approvedBy'];
if (Object.keys(approval).some(key => !fields.includes(key)) || fields.some(key => !(key in approval))) throw new Error('Approval must contain only the documented identity/review fields, never credentials.');
if (approval.projectId !== 'filmovy-kviz-v2-staging') throw new Error('Only filmovy-kviz-v2-staging is permitted.');
if (process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST || process.env.FIREBASE_CONFIG) throw new Error('Unexpected target override; run with an explicitly reviewed operator environment.');
if (!/^[A-Za-z0-9_-]{1,128}$/u.test(approval.targetUid) || typeof approval.targetEmail !== 'string' || !approval.targetEmail.includes('@') || approval.targetEmail.toLowerCase().endsWith('.test') || ['OT395koGquNshAMFT3Oj98xuU9A3', 'qnw4VgkI1kgN0sWliZ4kIDTTrvw1', 'nR4Kr4i6xSV44Q3YBhCADUelGhm2'].includes(approval.targetUid)) throw new Error('An exact approved personal UID and email are required. Synthetic accounts cannot become the personal owner.');
if (!Number.isSafeInteger(approval.expectedMembershipVersion) || approval.expectedMembershipVersion < 0 || !approval.approvalReference || !approval.approvedBy) throw new Error('Reviewed identity approval and expected version are required.');
const require = createRequire(new URL('../../functions/package.json', import.meta.url));
const { initializeApp, applicationDefault, deleteApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');
const app = initializeApp({ projectId: approval.projectId, credential: applicationDefault() });
try {
  const auth = getAuth(app), db = getFirestore(app), user = await auth.getUser(approval.targetUid);
  if (user.disabled || !user.emailVerified || user.email?.toLowerCase() !== approval.targetEmail.toLowerCase() || !user.providerData.some(p => p.providerId === 'password')) throw new Error('Target must be active, verified, email-matched and have its own password provider.');
  const ref = db.doc(`memberships/${user.uid}`), snapshot = await ref.get(), current = snapshot.data();
  if ((current?.version ?? 0) !== approval.expectedMembershipVersion) throw new Error('Membership changed; review a fresh plan.');
  const grant = { role: 'owner', permissions: [...permissions], quizzes: { mode: 'all', ids: [] }, events: { mode: 'all', ids: [] } };
  const plan = { action: 'add-approved-personal-owner', projectId: approval.projectId, targetUid: user.uid, targetEmail: user.email,
    emailVerified: true, expectedMembershipVersion: approval.expectedMembershipVersion, approvalReference: approval.approvalReference, approvedBy: approval.approvedBy,
    before: current ?? null, after: grant, preservesOtherAccounts: true, contentWrites: 0 };
  const planSha256 = createHash('sha256').update(JSON.stringify(plan)).digest('hex');
  if (!args.includes('--apply')) { console.log(JSON.stringify({ mode: 'DRY_RUN', plan, planSha256 }, null, 2)); }
  else {
    if (value('--confirm-plan-sha256') !== planSha256) throw new Error('Apply requires the exact SHA256 of the independently reviewed dry-run plan.');
    const fresh = await auth.getUser(user.uid);
    if (fresh.disabled || !fresh.emailVerified || fresh.email !== user.email) throw new Error('Identity changed after review.');
    await db.runTransaction(async tx => {
      const actual = await tx.get(ref), controlRef = db.doc('accessControl/state'), control = await tx.get(controlRef);
      if (JSON.stringify(actual.data() ?? null) !== JSON.stringify(current ?? null)) throw new Error('Membership changed after review.');
      const next = { ...(current ?? {}), ...grant, uid: user.uid, email: user.email, displayName: user.displayName ?? '', status: 'active', version: approval.expectedMembershipVersion + 1, sessionValidAfter: current?.sessionValidAfter ?? 0 };
      tx.set(ref, next);
      tx.set(controlRef, { revision: Number(control.data()?.revision ?? 0) + 1 }, { merge: true });
      tx.create(db.collection('accessAudit').doc(), { kind: 'approved-owner-bootstrap', actorUid: 'reviewed-operator', targetId: user.uid, at: Timestamp.now(), changes: { before: current ?? null, after: grant, approvalReference: approval.approvalReference, approvedBy: approval.approvedBy, planSha256 } });
    });
    console.log(JSON.stringify({ mode: 'APPLIED', projectId: approval.projectId, targetUid: user.uid, planSha256, otherAccountsChanged: false, contentWrites: 0 }));
  }
} finally { await deleteApp(app); }
