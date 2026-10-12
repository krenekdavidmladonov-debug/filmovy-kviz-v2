import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

export const PROJECT = 'filmovy-kviz-v2-staging';
export const RELEASE_SHA = 'ddb862f946a7621e4ff9dbfb30f8976ad8d0e3ac';
export const RECEIPT_SHA256 = '3507ab5d2742e50ff1798dfb1ffa1a3c2a166d1643d3c7ec3cd700bdedc5d375';
export const QA_RUN_ID = 'staging-qa-ddb862f-20261012-01';
export const USERS = Object.freeze(['operator', 'viewer'].map(slot => Object.freeze({ slot, uid: `${QA_RUN_ID}-${slot}`, email: `${QA_RUN_ID}-${slot}@example.test` })));
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const digest = value => hash(JSON.stringify(value));
export function demand(condition, code) { if (!condition) throw new Error(code); }
const exactKeys = (value, keys) => value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype
  && isDeepStrictEqual(Reflect.ownKeys(value).sort(), [...keys].sort());
const string = value => ({ stringValue: value });
const integer = value => ({ integerValue: String(value) });
const encode = value => typeof value === 'string' ? string(value) : typeof value === 'number' ? integer(value) : typeof value === 'boolean' ? { booleanValue: value }
  : Array.isArray(value) ? { arrayValue: { values: value.map(encode) } } : { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encode(item)])) } };
const fields = value => encode(value).mapValue.fields;
const operatorPermissions = ['quiz.read', 'quiz.create', 'quiz.edit', 'quiz.answers.read', 'quiz.answers.edit', 'quiz.notes.read', 'quiz.notes.edit',
  'quiz.media.upload', 'quiz.media.attach', 'quiz.export', 'event.read', 'event.create', 'event.manage', 'event.live', 'event.score', 'event.contacts',
  'event.answers.read', 'event.notes.read', 'event.export', 'event.answers.export'];

export function validateCredentials(credentials) {
  demand(exactKeys(credentials, ['mode', 'projectId', 'releaseSha', 'qaRunId', 'users']), 'INVALID_CREDENTIAL_ATTACHMENT');
  demand(credentials.mode === 'PRIVATE_RESTART_QA_CREDENTIALS' && credentials.projectId === PROJECT && credentials.releaseSha === RELEASE_SHA && credentials.qaRunId === QA_RUN_ID, 'FOREIGN_CREDENTIAL_ATTACHMENT');
  demand(exactKeys(credentials.users, ['operator', 'viewer']), 'EXACT_TWO_CREDENTIALS_REQUIRED');
  for (const user of USERS) {
    const entry = credentials.users[user.slot];
    demand(exactKeys(entry, ['uid', 'email', 'password']) && entry.uid === user.uid && entry.email === user.email, 'FOREIGN_CREDENTIAL_IDENTITY');
    demand(typeof entry.password === 'string' && entry.password.length >= 40 && entry.password.length <= 128
      && /^[A-Za-z0-9_!@#%+\-=]+$/u.test(entry.password) && /[a-z]/u.test(entry.password) && /[A-Z]/u.test(entry.password)
      && /[0-9]/u.test(entry.password) && /[^A-Za-z0-9]/u.test(entry.password), 'INVALID_PRIVATE_PASSWORD');
  }
  demand(credentials.users.operator.password !== credentials.users.viewer.password, 'DISTINCT_PASSWORDS_REQUIRED');
}

export function qaPlan(input) {
  const keys = ['projectId', 'releaseSha', 'artifactReceiptSha256', 'qaRunId', 'expectedRevision', 'expectedUpdateTime', 'operatorEmail',
    'approvedBy', 'approvalReference', 'qaLifecycleDecision', 'qaLifecycleApprovalReference', 'credentialsSha256'];
  demand(exactKeys(input, keys), 'INVALID_APPROVAL_FIELDS');
  const approval = structuredClone(input);
  demand(approval.projectId === PROJECT && approval.releaseSha === RELEASE_SHA && approval.artifactReceiptSha256 === RECEIPT_SHA256 && approval.qaRunId === QA_RUN_ID, 'FOREIGN_QA_TARGET');
  demand(Number.isSafeInteger(approval.expectedRevision) && approval.expectedRevision >= 0 && approval.expectedRevision < Number.MAX_SAFE_INTEGER, 'INVALID_CONTROL_REVISION');
  demand(typeof approval.expectedUpdateTime === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/u.test(approval.expectedUpdateTime)
    && Number.isFinite(Date.parse(approval.expectedUpdateTime)) && new Date(approval.expectedUpdateTime).toISOString().slice(0, 19) === approval.expectedUpdateTime.slice(0, 19), 'INVALID_CONTROL_TIME');
  demand(typeof approval.operatorEmail === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(approval.operatorEmail) && approval.operatorEmail.length <= 254, 'INVALID_OPERATOR_ACCOUNT');
  for (const key of ['approvedBy', 'approvalReference', 'qaLifecycleApprovalReference']) demand(typeof approval[key] === 'string' && approval[key].trim() === approval[key]
    && approval[key].length >= 3 && approval[key].length <= 300 && [...approval[key]].every(character => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127), 'EXPLICIT_REVIEW_REFERENCE_REQUIRED');
  demand(approval.qaLifecycleDecision === 'retention-approved', 'EXPLICIT_WHOLE_QA_RETENTION_REQUIRED');
  demand(typeof approval.credentialsSha256 === 'string' && /^[a-f0-9]{64}$/u.test(approval.credentialsSha256), 'INVALID_CREDENTIAL_DIGEST');
  const approvalSha256 = digest(approval), prefix = `projects/${PROJECT}/databases/(default)/documents/`;
  const controlName = `${prefix}accessControl/state`, auditName = `${prefix}accessAudit/restart-qa-provision-${approvalSha256}`;
  const memberships = USERS.map(user => {
    const own = user.slot === 'operator';
    return { name: `${prefix}memberships/${user.uid}`, fields: fields({ uid: user.uid, email: user.email, displayName: `QA ${QA_RUN_ID} ${user.slot}`,
      role: own ? 'manager' : 'viewer', status: 'active', version: 1, sessionValidAfter: 0, permissions: own ? operatorPermissions : ['quiz.read', 'event.read'],
      quizzes: { mode: own ? 'own' : 'none', ids: [] }, events: { mode: own ? 'own' : 'none', ids: [] }, createdBy: 'reviewed-operator' }) };
  });
  const auditFields = fields({ kind: 'approved-restart-qa-provision', actorUid: 'reviewed-operator', targetId: QA_RUN_ID,
    changes: { ...approval, approvalSha256, previousRevision: approval.expectedRevision, revision: approval.expectedRevision + 1,
      collaborationEnabled: false, identities: memberships.map(member => ({ name: member.name, grant: member.fields })) } });
  const writes = [...memberships.map(member => ({ update: member, currentDocument: { exists: false },
    updateTransforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }] })),
  { update: { name: auditName, fields: auditFields }, currentDocument: { exists: false }, updateTransforms: [{ fieldPath: 'at', setToServerValue: 'REQUEST_TIME' }] },
  { update: { name: controlName, fields: fields({ collaborationEnabled: false, revision: approval.expectedRevision + 1 }) },
    updateMask: { fieldPaths: ['collaborationEnabled', 'revision'] }, currentDocument: { updateTime: approval.expectedUpdateTime },
    updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }] }];
  return { action: 'PROVISION_EXACT_TWO_RESTART_QA_IDENTITIES', approval, approvalSha256, controlName, auditName, memberships, auditFields, writes,
    planSha256: digest({ approval, authCreates: USERS.map(({ uid, email }) => ({ uid, email, emailVerified: true })), writes }) };
}

function assertControl(document, plan, final = false) {
  demand(document?.name === plan.controlName && document.fields?.collaborationEnabled?.booleanValue === false
    && document.fields?.revision?.integerValue === String(plan.approval.expectedRevision + (final ? 1 : 0)), 'PAUSED_CONTROL_STATE_MISMATCH');
  demand(typeof document.updateTime === 'string' && (final || document.updateTime === plan.approval.expectedUpdateTime), 'STALE_CONTROL_CAS');
}
function assertAuth(user, expected, createdAt) {
  demand(user?.localId === expected.uid && user.email === expected.email && user.emailVerified === true && user.disabled !== true
    && typeof user.createdAt === 'string' && /^\d+$/u.test(user.createdAt), 'QA_AUTH_READBACK_MISMATCH');
  if (createdAt) demand(user.createdAt === createdAt, 'QA_AUTH_CREATION_CHANGED');
}
function assertFinal(audit, control, members, plan) {
  const { at, ...actualAudit } = audit?.fields ?? {};
  demand(audit?.name === plan.auditName && isDeepStrictEqual(actualAudit, plan.auditFields) && typeof at?.timestampValue === 'string', 'QA_AUDIT_MISMATCH');
  assertControl(control, plan, true);
  demand(control.updateTime === audit.updateTime, 'CONTROL_CHANGED_AFTER_PROVISION');
  for (let i = 0; i < members.length; i++) {
    const { createdAt, ...actual } = members[i]?.fields ?? {};
    demand(members[i]?.name === plan.memberships[i].name && isDeepStrictEqual(actual, plan.memberships[i].fields)
      && typeof createdAt?.timestampValue === 'string' && members[i].updateTime === audit.updateTime, 'QA_MEMBERSHIP_READBACK_MISMATCH');
  }
}

// No writes are retried or resumed. A partial/uncertain Auth outcome requires
// explicit read-only reconciliation and a separately reviewed recovery decision.
export async function executeQa({ plan, credentials, store, apply = false, reconcile = false, confirmPlanSha256, history = [], record }) {
  demand(isDeepStrictEqual(plan, qaPlan(plan.approval)), 'ALTERED_QA_PLAN');
  validateCredentials(credentials);
  demand(USERS.every(user => !JSON.stringify(plan).includes(credentials.users[user.slot].password)), 'PRIVATE_PASSWORD_IN_PUBLIC_APPROVAL');
  demand(!apply || (!reconcile && confirmPlanSha256 === plan.planSha256), 'EXACT_APPLY_CONFIRMATION_REQUIRED');
  demand(Array.isArray(history) && history.every(row => row.projectId === PROJECT && row.releaseSha === RELEASE_SHA
    && row.planSha256 === plan.planSha256), 'FOREIGN_OR_CHANGED_RECEIPT');
  const attempted = history.some(row => ['AUTH_CREATE_PENDING', 'FIRESTORE_COMMIT_PENDING'].includes(row.mode));
  demand(!apply || !attempted, 'PRIOR_WRITE_INTENT_REQUIRES_READ_ONLY_RECONCILIATION');
  const audit = await store.read(plan.auditName), control = await store.read(plan.controlName);
  const members = await Promise.all(plan.memberships.map(member => store.read(member.name)));
  if (reconcile) {
    demand(attempted, 'RECONCILIATION_REQUIRES_ORIGINAL_WRITE_RECEIPT');
    const owned = [], unconfirmedAuth = [];
    for (const expected of USERS) {
      const current = await store.readAuth(expected.uid), confirmed = history.filter(row => row.mode === 'AUTH_CREATED' && row.uid === expected.uid);
      demand(confirmed.length <= 1, 'DUPLICATE_AUTH_CONFIRMATION');
      if (confirmed.length) { assertAuth(current, expected, confirmed[0].createdAt); owned.push(expected.uid); }
      else unconfirmedAuth.push({ uid: expected.uid, state: current ? 'PRESENT_OWNERSHIP_UNCONFIRMED' : 'ABSENT_AT_READ_NOT_PROOF_OF_FAILED_CREATE' });
    }
    if (audit) {
      demand(owned.length === 2, 'AUTH_OWNERSHIP_UNCONFIRMED');
      assertFinal(audit, control, members, plan);
      return { mode: 'READ_RECONCILED_APPLIED', planSha256: plan.planSha256, auditName: plan.auditName, controlUpdateTime: control.updateTime, writes: 0 };
    }
    demand(members.every(member => member === null), 'PARTIAL_OR_FOREIGN_MEMBERSHIP_STATE');
    assertControl(control, plan);
    return { mode: 'READ_RECONCILED_INCOMPLETE_NO_RETRY', planSha256: plan.planSha256, confirmedOwnedAuthUids: owned, unconfirmedAuth,
      instruction: 'Preserve original receipt and private attachment. No writes resumed; separately review recovery or retention.', writes: 0 };
  }
  demand(audit === null && members.every(member => member === null), 'QA_MEMBERSHIP_OR_AUDIT_COLLISION');
  assertControl(control, plan);
  demand(await store.identitiesAbsent(), 'QA_AUTH_UID_OR_EMAIL_COLLISION');
  if (!apply) return { mode: 'DRY_RUN_NOT_AUTHORITY', plan, writes: 0 };
  demand(typeof record === 'function', 'DURABLE_INTENT_RECORDER_REQUIRED');
  const authCreated = [];
  for (const expected of USERS) {
    await record({ mode: 'AUTH_CREATE_PENDING', uid: expected.uid });
    const created = await store.createAuth(expected.uid, credentials.users[expected.slot].password);
    demand(created?.localId === expected.uid, 'QA_AUTH_CREATE_RESPONSE_MISMATCH');
    const current = await store.readAuth(expected.uid); assertAuth(current, expected);
    authCreated.push(current.createdAt);
    await record({ mode: 'AUTH_CREATED', uid: expected.uid, createdAt: current.createdAt });
  }
  // Recheck pause immediately before the CAS commit. This does not make Auth and
  // Firestore atomic; a control conflict leaves new Auth users without membership.
  assertControl(await store.read(plan.controlName), plan);
  for (let i = 0; i < USERS.length; i++) assertAuth(await store.readAuth(USERS[i].uid), USERS[i], authCreated[i]);
  await record({ mode: 'FIRESTORE_COMMIT_PENDING', auditName: plan.auditName });
  await store.commit(plan.writes);
  const finalAudit = await store.read(plan.auditName), finalControl = await store.read(plan.controlName);
  const finalMembers = await Promise.all(plan.memberships.map(member => store.read(member.name)));
  assertFinal(finalAudit, finalControl, finalMembers, plan);
  return { mode: 'APPLIED', planSha256: plan.planSha256, auditName: plan.auditName, controlUpdateTime: finalControl.updateTime, authCreates: 2, firestoreWrites: 4 };
}
