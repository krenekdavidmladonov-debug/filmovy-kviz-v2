import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { permissions } from '../../packages/quiz-domain/lib/access.js';

const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
export const digest = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
export const ownerGrant = { role: 'owner', permissions: [...permissions], quizzes: { mode: 'all', ids: [] }, events: { mode: 'all', ids: [] } };
const requireThat = (condition, message) => assert.ok(condition, message);

export function validateApproval(approval, policy) {
  const keys = ['mode', 'projectId', 'targetUid', 'targetEmail', 'expectedMembershipVersion', 'expectedMembershipDigest',
    'passwordBaselineUpdatedAt', 'passwordObservedAt', 'qaRetirementDigest', 'approvalReference', 'reason'];
  requireThat(approval && Object.keys(approval).length === keys.length && keys.every(k => k in approval), 'Exact private approval fields required.');
  requireThat(approval.mode === 'take-over-existing-staging-admin', 'Explicit existing-account exception required.');
  requireThat(approval.projectId === policy.projectId && approval.targetUid === policy.allowedUid, 'Project or approved legacy identity mismatch.');
  requireThat(typeof approval.targetEmail === 'string' && approval.targetEmail === approval.targetEmail.trim()
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(approval.targetEmail) && !approval.targetEmail.toLowerCase().endsWith('.test'), 'Exact personal email required.');
  requireThat(Number.isSafeInteger(approval.expectedMembershipVersion) && approval.expectedMembershipVersion > 0, 'Expected manager version required.');
  for (const key of ['expectedMembershipDigest', 'qaRetirementDigest']) requireThat(/^[a-f0-9]{64}$/u.test(approval[key]), 'Reviewed evidence digest required.');
  requireThat(Number.isFinite(approval.passwordBaselineUpdatedAt) && approval.passwordBaselineUpdatedAt > 0
    && Number.isFinite(approval.passwordObservedAt) && approval.passwordObservedAt >= approval.passwordBaselineUpdatedAt, 'Observed password baseline required.');
  for (const key of ['approvalReference', 'reason']) requireThat(typeof approval[key] === 'string' && approval[key].trim().length >= 12 && approval[key].length <= 1000, 'Explicit private approval and reason required.');
}

function identity(user, approval) {
  requireThat(user && user.uid === approval.targetUid && user.email === approval.targetEmail, 'Exact Auth identity mismatch.');
  requireThat(user.emailVerified === true && user.disabled === false, 'Account must be verified and enabled.');
  requireThat(user.providers.length === 1 && user.providers[0] === 'password' && !user.customAuth && !user.emailLinkSignin && !user.phoneLinked && !user.tenantId,
    'Additional login route requires separate review.');
}
function manager(member, approval) {
  requireThat(member?.uid === approval.targetUid && member.role === 'manager' && member.status === 'active', 'Active existing manager required.');
  requireThat(digest({ ...ownerGrant, role: 'manager' }) === digest({ role: member.role, permissions: member.permissions, quizzes: member.quizzes, events: member.events }), 'Full existing manager grant required.');
}
function completed(state, approval, operationId) {
  if (!state.finished) return false;
  requireThat(state.finished.kind === 'approved-owner-bootstrap' && state.finished.targetId === approval.targetUid
    && state.finished.changes.operationId === operationId && state.finished.changes.approvalDigest === digest(approval), 'Completion receipt mismatch.');
  requireThat(state.member?.uid === approval.targetUid && state.member.status === 'active'
    && digest({ role: state.member.role, permissions: state.member.permissions, quizzes: state.member.quizzes, events: state.member.events }) === digest(ownerGrant)
    && state.member.sessionValidAfter >= state.finished.changes.cutoff, 'Completed ownership state changed; manual review required.');
  return true;
}

/** Only the CLI supplies the live policy/adapter. Tests use isolated synthetic identities. */
export async function takeover({ approval, policy, retirement, operator, auth, store, apply = false, confirmPlanSha256, now = Date.now }) {
  validateApproval(approval, policy);
  requireThat(retirement.retired === true && retirement.protectedUidDigest === digest(approval.targetUid)
    && digest(retirement) === approval.qaRetirementDigest, 'QA retirement evidence missing or changed.');
  requireThat(operator?.provider === 'google-oauth' && operator.verified === true && operator.subject && operator.email, 'Server-verified operator identity required.');
  const operationId = digest({ project: approval.projectId, uid: approval.targetUid, reference: approval.approvalReference });
  const actor = { actorUid: `google-oauth:${operator.subject}`, actorEmail: operator.email, actorType: 'operator' };
  const user = await auth.lookup(); identity(user, approval);
  const state = await store.read(operationId);
  if (completed(state, approval, operationId)) return { status: 'NO_OP', operationId, role: 'owner', writes: 0 };
  requireThat(state.owners.length === 0, 'An owner already exists.');
  requireThat(state.control && Number.isSafeInteger(state.control.revision), 'Canonical access control state required.');
  const before = state.started?.changes.before ?? state.member;
  manager(before, approval);
  requireThat(before.version === approval.expectedMembershipVersion && digest(before) === approval.expectedMembershipDigest, 'Manager state differs from reviewed approval.');
  if (state.started) {
    requireThat(state.started.kind === 'owner-takeover-session-cutoff' && state.started.targetId === approval.targetUid
      && state.started.changes.operationId === operationId && state.started.changes.approvalDigest === digest(approval), 'Partial operation receipt mismatch.');
    requireThat(digest(state.member) === digest({ ...before, version: before.version + 1, sessionValidAfter: state.started.changes.cutoff }), 'Partial manager state changed.');
  }
  const secured = Number.isFinite(user.passwordUpdatedAt) && user.passwordUpdatedAt > approval.passwordBaselineUpdatedAt
    && user.passwordUpdatedAt > approval.passwordObservedAt;
  const plan = { operationId, approvalDigest: digest(approval), before, after: ownerGrant, actor,
    passwordUpdatedAt: user.passwordUpdatedAt, securitySatisfied: secured, contentWrites: 0, authChanges: ['revokeRefreshTokens'],
    firestoreOrder: ['session-cutoff-and-audit', 'owner-and-audit'], storesAreNotAtomic: true };
  const planSha256 = digest(plan);
  if (!apply) return { status: secured ? 'DRY_RUN_READY' : 'WAITING_FOR_PASSWORD_CHANGE', plan, planSha256, writes: 0 };
  requireThat(secured, 'Personal password has not changed since the recorded security observation.');
  requireThat(confirmPlanSha256 === planSha256, 'Apply requires the exact independently reviewed dry-run hash.');
  const fresh = await auth.lookup(); identity(fresh, approval);
  requireThat(fresh.passwordUpdatedAt === user.passwordUpdatedAt, 'Auth changed after the dry-run.');
  const timestamp = new Date(now());
  const initial = await store.transact(operationId, current => {
    if (completed(current, approval, operationId)) return { result: { done: true } };
    requireThat(current.owners.length === 0, 'An owner appeared before session revocation.');
    if (current.started) {
      requireThat(current.started.changes.planSha256 === planSha256
        && digest(current.member) === digest({ ...before, version: before.version + 1, sessionValidAfter: current.started.changes.cutoff }), 'Partial operation changed.');
      return { result: { cutoff: current.started.changes.cutoff } };
    }
    requireThat(digest(current.member) === digest(before), 'Manager changed before session revocation.');
    const cutoff = Math.max(Math.floor(now() / 1000), Number(before.sessionValidAfter));
    return { stage: 'cutoff', memberPatch: { sessionValidAfter: cutoff, version: before.version + 1 },
      audit: { kind: 'owner-takeover-session-cutoff', ...actor, targetId: approval.targetUid, at: timestamp,
        changes: { operationId, approvalDigest: digest(approval), planSha256, before, cutoff, reason: approval.reason,
          approvalReference: approval.approvalReference, authRevocationPending: true } }, result: { cutoff } };
  });
  if (initial.done) return { status: 'NO_OP', operationId, role: 'owner', writes: 0 };
  // Auth and Firestore cannot commit atomically. A failure here leaves a manager with
  // an enforced cutoff and a resumable intent; it NEVER leaves a prematurely promoted owner.
  try { await auth.revoke(approval.targetUid); }
  catch { throw new Error('SESSION_CUTOFF_RECORDED; AUTH_REVOCATION_INCOMPLETE; OWNER_UNCHANGED. Retry the same reviewed operation.'); }
  const revoked = await auth.lookup(); identity(revoked, approval);
  requireThat(revoked.passwordUpdatedAt === user.passwordUpdatedAt && revoked.validSince >= initial.cutoff, 'Auth revocation read-back or identity check failed; owner unchanged.');
  const result = await store.transact(operationId, current => {
    if (completed(current, approval, operationId)) return { result: { status: 'ALREADY_COMPLETED_AFTER_AUTH_REVOCATION', operationId, role: 'owner', firestoreWrites: 0, authRevocationAttempted: true } };
    requireThat(current.owners.length === 0, 'Another owner appeared; target remains manager.');
    requireThat(current.started?.changes.planSha256 === planSha256 && current.started.changes.cutoff === initial.cutoff
      && digest(current.member) === digest({ ...before, version: before.version + 1, sessionValidAfter: initial.cutoff }), 'Manager or revocation intent changed; owner unchanged.');
    return { stage: 'owner', memberPatch: { ...ownerGrant, version: before.version + 2 },
      audit: { kind: 'approved-owner-bootstrap', ...actor, targetId: approval.targetUid, at: new Date(now()),
        changes: { operationId, approvalDigest: digest(approval), planSha256, before, after: ownerGrant, cutoff: initial.cutoff,
          passwordUpdatedAt: user.passwordUpdatedAt, authRevokedAt: revoked.validSince, reason: approval.reason,
          approvalReference: approval.approvalReference, existingAccountTakeover: true } },
      result: { status: 'APPLIED', operationId, role: 'owner', cutoff: initial.cutoff, authRevocationAttempted: true, otherAccountsChanged: false, contentWrites: 0 } };
  });
  const after = await store.read(operationId);
  requireThat(completed(after, approval, operationId), 'Owner read-back failed.');
  return result;
}

export function firestoreTakeoverStore(db, uid) {
  const memberRef = db.doc(`memberships/${uid}`), controlRef = db.doc('accessControl/state');
  const refs = operationId => ({ start: db.doc(`accessAudit/owner-takeover-cutoff-${operationId}`), finish: db.doc(`accessAudit/owner-takeover-complete-${operationId}`) });
  async function readWith(io, operationId) {
    const audit = refs(operationId);
    const member = await io.get(memberRef), control = await io.get(controlRef);
    const owners = await io.get(db.collection('memberships').where('role', '==', 'owner'));
    const started = await io.get(audit.start), finished = await io.get(audit.finish);
    return { member: member.data() ?? null, control: control.data() ?? null, owners: owners.docs.map(d => d.data()), started: started.data() ?? null, finished: finished.data() ?? null };
  }
  return {
    read: operationId => db.runTransaction(tx => readWith(tx, operationId), { readOnly: true }),
    transact: (operationId, action) => db.runTransaction(async tx => {
      const state = await readWith(tx, operationId), change = action(state);
      if (change.stage) {
        requireThat(state.control && Number.isSafeInteger(state.control.revision), 'Canonical control changed.');
        tx.update(memberRef, change.memberPatch);
        tx.update(controlRef, { revision: state.control.revision + 1 });
        tx.create(change.stage === 'cutoff' ? refs(operationId).start : refs(operationId).finish, change.audit);
      }
      return change.result;
    }),
  };
}
