import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const text = value => ({ stringValue: value });
const integer = value => ({ integerValue: String(value) });

// Pure operator policy. Demo projects are accepted here solely for emulator tests;
// the executable adapter independently permits only the fixed V2 staging project.
export function pausePlan(input) {
  const keys = ['projectId', 'releaseSha', 'expectedRevision', 'expectedUpdateTime', 'operatorEmail', 'approvedBy', 'approvalReference'];
  assert(input && typeof input === 'object' && !Array.isArray(input), 'Approval object required');
  assert.deepEqual(Object.keys(input).sort(), [...keys].sort(), 'Unexpected approval fields');
  const approval = Object.fromEntries(keys.map(key => [key, input[key]]));
  assert(approval.projectId === 'filmovy-kviz-v2-staging' || /^demo-[a-z0-9-]{1,40}$/u.test(approval.projectId), 'Target denied');
  assert.match(approval.releaseSha, /^[a-f0-9]{40}$/u);
  assert(typeof approval.operatorEmail === 'string' && approval.operatorEmail.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(approval.operatorEmail), 'Exact operator CLI account email required');
  assert(Number.isSafeInteger(approval.expectedRevision) && approval.expectedRevision >= 0 && approval.expectedRevision < Number.MAX_SAFE_INTEGER, 'Invalid revision');
  assert.match(approval.expectedUpdateTime, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/u);
  const date = new Date(approval.expectedUpdateTime);
  assert(Number.isFinite(date.getTime()) && date.toISOString().slice(0, 19) === approval.expectedUpdateTime.slice(0, 19), 'Invalid update time');
  for (const key of ['approvedBy', 'approvalReference']) assert(typeof approval[key] === 'string' && approval[key].trim() === approval[key] && approval[key].length >= 3 && approval[key].length <= 300 && [...approval[key]].every(character => character.charCodeAt(0) >= 32), 'Review reference required');
  const approvalSha256 = digest(approval);
  const prefix = `projects/${approval.projectId}/databases/(default)/documents/`;
  const controlName = `${prefix}accessControl/state`;
  const auditName = `${prefix}accessAudit/collaboration-pause-${approvalSha256}`;
  const auditFields = {
    kind: text('approved-collaboration-pause'), actorUid: text('reviewed-operator'), targetId: text('accessControl/state'),
    changes: { mapValue: { fields: {
      releaseSha: text(approval.releaseSha), approvalSha256: text(approvalSha256),
      operatorEmail: text(approval.operatorEmail), approvedBy: text(approval.approvedBy), approvalReference: text(approval.approvalReference),
      previousRevision: integer(approval.expectedRevision), revision: integer(approval.expectedRevision + 1),
      previousCollaborationEnabled: { booleanValue: true }, collaborationEnabled: { booleanValue: false },
      expectedUpdateTime: text(approval.expectedUpdateTime),
    } } },
  };
  const writes = [
    { update: { name: controlName, fields: { collaborationEnabled: { booleanValue: false }, revision: integer(approval.expectedRevision + 1) } },
      updateMask: { fieldPaths: ['collaborationEnabled', 'revision'] }, currentDocument: { updateTime: approval.expectedUpdateTime },
      updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }] },
    { update: { name: auditName, fields: auditFields }, currentDocument: { exists: false },
      updateTransforms: [{ fieldPath: 'at', setToServerValue: 'REQUEST_TIME' }] },
  ];
  return { action: 'PAUSE_COLLABORATION_ONLY', approval, approvalSha256, controlName, auditName, auditFields, writes, planSha256: digest(writes) };
}

function assertControl(document, plan, enabled, revision) {
  assert.equal(document?.name, plan.controlName, 'Control document missing or foreign');
  assert.equal(document.fields?.collaborationEnabled?.booleanValue, enabled, 'Collaboration state changed');
  assert.equal(document.fields?.revision?.integerValue, String(revision), 'Control revision changed');
  assert.match(document.updateTime, /^\d{4}-\d{2}-\d{2}T.+Z$/u, 'Control update time missing');
}

function assertAudit(document, plan) {
  assert.equal(document?.name, plan.auditName, 'Audit document missing or foreign');
  const { at, ...fields } = document.fields ?? {};
  assert(isDeepStrictEqual(fields, plan.auditFields) && typeof at?.timestampValue === 'string', 'Audit does not match reviewed operation');
}

export async function executePause({ approval, store, apply = false, confirmPlanSha256, beforeCommit = () => {} }) {
  const plan = pausePlan(approval);
  if (apply) assert.equal(confirmPlanSha256, plan.planSha256, 'Exact reviewed plan hash required');
  const audit = await store.read(plan.auditName);
  const control = await store.read(plan.controlName);
  if (audit) {
    assertAudit(audit, plan);
    assertControl(control, plan, false, plan.approval.expectedRevision + 1);
    assert.equal(control.updateTime, audit.updateTime, 'Control changed after audited pause');
    return { mode: 'ALREADY_APPLIED', planSha256: plan.planSha256, auditName: plan.auditName, controlUpdateTime: control.updateTime, writes: 0 };
  }
  assertControl(control, plan, true, plan.approval.expectedRevision);
  assert.equal(control.updateTime, plan.approval.expectedUpdateTime, 'Control update time changed');
  if (!apply) return { mode: 'DRY_RUN', plan };
  // The remote commit atomically checks the full updateTime and creates the audit.
  // There is no retry: after an uncertain outcome, reread with the SAME approval.
  await beforeCommit({ mode: 'COMMIT_OUTCOME_PENDING', planSha256: plan.planSha256, auditName: plan.auditName });
  await store.commit(plan.writes);
  const finalAudit = await store.read(plan.auditName), finalControl = await store.read(plan.controlName);
  assertAudit(finalAudit, plan);
  assertControl(finalControl, plan, false, plan.approval.expectedRevision + 1);
  assert.equal(finalControl.updateTime, finalAudit.updateTime, 'Control changed after audited pause');
  return { mode: 'APPLIED', planSha256: plan.planSha256, auditName: plan.auditName, controlUpdateTime: finalControl.updateTime, writes: 2 };
}
