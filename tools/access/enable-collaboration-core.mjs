import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { pausePlan } from './pause-collaboration-core.mjs';

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const text = stringValue => ({ stringValue });
const integer = value => ({ integerValue: String(value) });
const baseKeys = ['projectId', 'releaseSha', 'expectedRevision', 'expectedUpdateTime', 'operatorEmail', 'approvedBy', 'approvalReference'];
export function enablePlan(input) {
  assert(input && typeof input === 'object' && !Array.isArray(input));
  const keys = [...baseKeys, 'collaborationEnableApproved', 'invitationSummarySha256'];
  assert.deepEqual(Object.keys(input).sort(), keys.sort(), 'Unexpected enable approval fields');
  // Reuse the existing strict approval validation; do not change pause behavior.
  pausePlan(Object.fromEntries(baseKeys.map(k => [k, input[k]])));
  assert.equal(input.collaborationEnableApproved, true, 'Explicit enable approval required');
  assert.match(input.invitationSummarySha256, /^[a-f0-9]{64}$/u);
  const approval = Object.fromEntries([...baseKeys, 'collaborationEnableApproved', 'invitationSummarySha256'].map(k => [k, input[k]]));
  const approvalSha256 = digest(approval), prefix = `projects/${approval.projectId}/databases/(default)/documents/`;
  const controlName = prefix + 'accessControl/state', auditName = prefix + 'accessAudit/collaboration-enable-' + approvalSha256;
  const auditFields = { kind: text('approved-collaboration-enable'), actorUid: text('reviewed-operator'), targetId: text('accessControl/state'), changes: { mapValue: { fields: {
    releaseSha: text(approval.releaseSha), approvalSha256: text(approvalSha256), operatorEmail: text(approval.operatorEmail), approvedBy: text(approval.approvedBy), approvalReference: text(approval.approvalReference),
    previousRevision: integer(approval.expectedRevision), revision: integer(approval.expectedRevision + 1), previousCollaborationEnabled: { booleanValue: false }, collaborationEnabled: { booleanValue: true },
    expectedUpdateTime: text(approval.expectedUpdateTime), invitationSummarySha256: text(approval.invitationSummarySha256), reviewedInvitationCount: integer(0), reviewedUnexpiredPending: integer(0), reviewedMalformedPending: integer(0),
  } } } };
  const writes = [
    { update: { name: controlName, fields: { collaborationEnabled: { booleanValue: true }, revision: integer(approval.expectedRevision + 1) } }, updateMask: { fieldPaths: ['collaborationEnabled', 'revision'] }, currentDocument: { updateTime: approval.expectedUpdateTime }, updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }] },
    { update: { name: auditName, fields: auditFields }, currentDocument: { exists: false }, updateTransforms: [{ fieldPath: 'at', setToServerValue: 'REQUEST_TIME' }] },
  ];
  return { action: 'ENABLE_COLLABORATION_ONLY', approval, approvalSha256, controlName, auditName, auditFields, writes, planSha256: digest(writes) };
}

export function assertInvitationPreflight(value, projectId) {
  assert.equal(value.projectId, projectId, 'Foreign invitation summary');
  assert.equal(value.total, 0, 'Invitation collection no longer empty');
  for (const key of ['pending', 'unexpiredPending', 'malformedPending', 'cloudWrites', 'contactReads', 'tokenReads', 'grantReads']) assert.equal(value[key], 0, 'Unsafe invitation preflight');
  assert.deepEqual(value.fieldsRead, ['status', 'expiresAt']);
  assert(Number.isFinite(Date.parse(value.at)) && Number.isSafeInteger(value.pages) && value.pages >= 1);
}

// Input contains only REST-projected status/expiry metadata, never grant/contact/token.
export function summarizeInvitations(documents, nowMillis) {
  assert(Number.isSafeInteger(nowMillis) && nowMillis >= 0);
  const result = { total: documents.length, pending: 0, unexpiredPending: 0, malformedPending: 0 };
  for (const doc of documents) {
    const fields = doc.fields ?? {};
    assert(Object.keys(fields).every(k => ['status', 'expiresAt'].includes(k)), 'Unmasked invitation fields');
    const status = fields.status?.stringValue;
    if (!['invited', 'accepted', 'revoked'].includes(status)) { result.malformedPending++; continue; }
    if (status !== 'invited') continue;
    result.pending++;
    const expiry = fields.expiresAt;
    const millis = typeof expiry?.integerValue === 'string' && /^\d+$/u.test(expiry.integerValue) ? Number(expiry.integerValue) : expiry?.doubleValue;
    if (!Number.isSafeInteger(millis) || millis < 0) result.malformedPending++;
    else if (millis > nowMillis) result.unexpiredPending++;
  }
  return result;
}

function control(doc, plan, enabled, revision) {
  assert.equal(doc?.name, plan.controlName, 'Control missing or foreign');
  assert.equal(doc.fields?.collaborationEnabled?.booleanValue, enabled, 'Control state changed');
  assert.equal(doc.fields?.revision?.integerValue, String(revision), 'Control revision changed');
  assert(typeof doc.updateTime === 'string');
}
function audit(doc, plan) {
  assert.equal(doc?.name, plan.auditName, 'Audit missing or foreign');
  const { at, ...fields } = doc.fields ?? {};
  assert(isDeepStrictEqual(fields, plan.auditFields) && typeof at?.timestampValue === 'string', 'Audit mismatch');
}
export async function executeEnable({ approval, store, apply = false, confirmPlanSha256, beforeCommit = () => {} }) {
  const plan = enablePlan(approval);
  if (apply) assert.equal(confirmPlanSha256, plan.planSha256, 'Exact reviewed plan hash required');
  const existingAudit = await store.read(plan.auditName), current = await store.read(plan.controlName);
  if (existingAudit) {
    audit(existingAudit, plan); control(current, plan, true, approval.expectedRevision + 1);
    assert.equal(current.updateTime, existingAudit.updateTime, 'Control changed after audited enable');
    return { mode: 'ALREADY_APPLIED', planSha256: plan.planSha256, auditName: plan.auditName, controlUpdateTime: current.updateTime, writes: 0 };
  }
  control(current, plan, false, approval.expectedRevision); assert.equal(current.updateTime, approval.expectedUpdateTime, 'Control update time changed');
  const invitations = await store.readInvitationSummary(); assertInvitationPreflight(invitations, approval.projectId);
  if (!apply) return { mode: 'READ_ONLY_PREFLIGHT', plan, invitations };
  await beforeCommit({ mode: 'COMMIT_OUTCOME_PENDING', planSha256: plan.planSha256, auditName: plan.auditName });
  // Atomic CAS + create-only audit. Transport has retries:0; no catch/retry here.
  await store.commit(plan.writes);
  const finalAudit = await store.read(plan.auditName), finalControl = await store.read(plan.controlName);
  audit(finalAudit, plan); control(finalControl, plan, true, approval.expectedRevision + 1);
  assert.equal(finalControl.updateTime, finalAudit.updateTime, 'Control changed after audited enable');
  return { mode: 'APPLIED', planSha256: plan.planSha256, auditName: plan.auditName, controlUpdateTime: finalControl.updateTime, writes: 2 };
}
