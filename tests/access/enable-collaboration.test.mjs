import assert from 'node:assert/strict';
import test from 'node:test';
import { enablePlan, executeEnable, summarizeInvitations, assertInvitationPreflight } from '../../tools/access/enable-collaboration-core.mjs';
import { readMaskedInvitations } from '../../tools/access/enable-collaboration.mjs';
import { pauseStore } from '../../tools/access/pause-collaboration-store.mjs';
const approval = { projectId: 'demo-enable-test', releaseSha: 'a'.repeat(40), expectedRevision: 21, expectedUpdateTime: '2026-10-12T21:33:30.823178Z', operatorEmail: 'operator@example.test', approvedBy: 'synthetic-reviewer', approvalReference: 'synthetic-enable-approval', collaborationEnableApproved: true, invitationSummarySha256: 'b'.repeat(64) };
const after = '2026-10-15T12:00:00.000001Z';
const summary = projectId => ({ at: '2026-10-15T11:13:13.650Z', projectId, pages: 1, total: 0, pending: 0, unexpiredPending: 0, malformedPending: 0, fieldsRead: ['status', 'expiresAt'], cloudWrites: 0, contactReads: 0, tokenReads: 0, grantReads: 0 });
function fixture() {
  const plan = enablePlan(approval), docs = new Map([[plan.controlName, { name: plan.controlName, updateTime: approval.expectedUpdateTime, fields: { collaborationEnabled: { booleanValue: false }, revision: { integerValue: '21' }, sentinel: { stringValue: 'preserved' } } }]]); let commits = 0;
  const store = { read: async n => structuredClone(docs.get(n) ?? null), readInvitationSummary: async () => summary(approval.projectId), commit: async writes => {
    assert.equal(docs.get(plan.controlName).updateTime, writes[0].currentDocument.updateTime); assert(!docs.has(plan.auditName)); commits++;
    docs.set(plan.controlName, { ...docs.get(plan.controlName), updateTime: after, fields: { ...docs.get(plan.controlName).fields, ...writes[0].update.fields, updatedAt: { timestampValue: after } } });
    docs.set(plan.auditName, { ...writes[1].update, updateTime: after, fields: { ...writes[1].update.fields, at: { timestampValue: after } } });
  } };
  return { plan, docs, store, commits: () => commits };
}
test('enable plan preserves exact nanosecond CAS, only two control fields and create-only audit', () => {
  const p = enablePlan(approval); assert.equal(p.writes.length, 2); assert.equal(p.writes[0].currentDocument.updateTime, approval.expectedUpdateTime);
  assert.deepEqual(p.writes[0].update.fields, { collaborationEnabled: { booleanValue: true }, revision: { integerValue: '22' } });
  assert.deepEqual(p.writes[0].updateMask.fieldPaths, ['collaborationEnabled', 'revision']); assert.deepEqual(p.writes[1].currentDocument, { exists: false });
  assert.equal(p.auditFields.changes.mapValue.fields.previousCollaborationEnabled.booleanValue, false);
  assert.deepEqual(enablePlan(Object.fromEntries(Object.entries(approval).reverse())), p);
});
test('foreign target, missing approval, unknown fields, invalid CAS or unbound invitation receipt rejected', () => {
  for (const patch of [{ projectId: 'production' }, { collaborationEnableApproved: false }, { expectedRevision: -1 }, { expectedRevision: Number.MAX_SAFE_INTEGER }, { expectedUpdateTime: '2026-02-31T12:00:00Z' }, { releaseSha: 'main' }, { invitationSummarySha256: '' }, { extra: true }]) assert.throws(() => enablePlan({ ...approval, ...patch }));
});
test('read-only preflight writes nothing; apply preserves other fields and repeat only reconciles', async () => {
  const f = fixture(); assert.equal((await executeEnable({ approval, store: f.store })).mode, 'READ_ONLY_PREFLIGHT'); assert.equal(f.commits(), 0);
  let journaled = false; const r = await executeEnable({ approval, store: f.store, apply: true, confirmPlanSha256: f.plan.planSha256, beforeCommit: () => { journaled = true; } });
  assert(journaled); assert.equal(r.mode, 'APPLIED'); assert.equal(f.commits(), 1); assert.equal(f.docs.get(f.plan.controlName).fields.sentinel.stringValue, 'preserved'); assert.equal(f.docs.size, 2);
  assert.equal((await executeEnable({ approval, store: f.store })).mode, 'ALREADY_APPLIED'); assert.equal(f.commits(), 1);
});
test('stale state/revision/updateTime, missing state or foreign control cannot commit', async () => {
  for (const mutate of [d => { d.fields.collaborationEnabled.booleanValue = true; }, d => { d.fields.revision.integerValue = '22'; }, d => { d.updateTime = after; }, d => { d.name = 'foreign'; }]) {
    const f = fixture(); mutate(f.docs.get(f.plan.controlName)); await assert.rejects(executeEnable({ approval, store: f.store, apply: true, confirmPlanSha256: f.plan.planSha256 })); assert.equal(f.commits(), 0);
  }
  const f = fixture(); f.docs.clear(); await assert.rejects(executeEnable({ approval, store: f.store }));
});
test('new, malformed, unexpired or foreign invitation summaries block enable', async () => {
  for (const patch of [{ total: 1 }, { pending: 1 }, { unexpiredPending: 1 }, { malformedPending: 1 }, { projectId: 'foreign' }, { fieldsRead: ['email'] }]) {
    const f = fixture(); f.store.readInvitationSummary = async () => ({ ...summary(approval.projectId), ...patch });
    await assert.rejects(executeEnable({ approval, store: f.store, apply: true, confirmPlanSha256: f.plan.planSha256 })); assert.equal(f.commits(), 0);
  }
});
test('CAS race and journal failure prevent commit; absent confirmation prevents even read', async () => {
  const f = fixture(); await assert.rejects(executeEnable({ approval, store: f.store, apply: true, confirmPlanSha256: f.plan.planSha256, beforeCommit: () => { f.docs.get(f.plan.controlName).updateTime = after; } })); assert.equal(f.commits(), 0);
  const g = fixture(); await assert.rejects(executeEnable({ approval, store: g.store, apply: true, confirmPlanSha256: g.plan.planSha256, beforeCommit: () => { throw Error('disk'); } })); assert.equal(g.commits(), 0);
  await assert.rejects(executeEnable({ approval, store: { read: () => assert.fail() }, apply: true }));
});
test('lost commit response reconciles SAME audit without another write; drift never passes', async () => {
  const f = fixture(), commit = f.store.commit; f.store.commit = async w => { await commit(w); throw Error('lost'); };
  await assert.rejects(executeEnable({ approval, store: f.store, apply: true, confirmPlanSha256: f.plan.planSha256 }), /lost/u);
  assert.equal((await executeEnable({ approval, store: f.store })).mode, 'ALREADY_APPLIED'); assert.equal(f.commits(), 1);
  f.docs.get(f.plan.controlName).updateTime = '2026-10-15T12:01:00Z'; await assert.rejects(executeEnable({ approval, store: f.store })); assert.equal(f.commits(), 1);
});
test('uncertain request never retries internally; persisted attempt gate blocks another apply', async () => {
  const f = fixture(); let requests = 0, attempted = false;
  f.store.commit = async () => { requests++; throw Error('uncertain'); };
  const beforeCommit = () => { assert(!attempted, 'Existing attempt fence'); attempted = true; };
  await assert.rejects(executeEnable({ approval, store: f.store, apply: true, confirmPlanSha256: f.plan.planSha256, beforeCommit })); assert.equal(requests, 1);
  assert.equal((await executeEnable({ approval, store: f.store })).mode, 'READ_ONLY_PREFLIGHT'); assert.equal(requests, 1);
  await assert.rejects(executeEnable({ approval, store: f.store, apply: true, confirmPlanSha256: f.plan.planSha256, beforeCommit }), /fence/u); assert.equal(requests, 1);
});
test('masked expiry parser accepts only integer Unix millis, including integral REST doubles', () => {
  const doc = expiresAt => ({ fields: { status: { stringValue: 'invited' }, expiresAt } });
  assert.deepEqual(summarizeInvitations([doc({ integerValue: '999' }), doc({ doubleValue: 1001 }), doc({ doubleValue: 1.5 }), doc({ timestampValue: after })], 1000), { total: 4, pending: 4, unexpiredPending: 1, malformedPending: 2 });
  assert.throws(() => summarizeInvitations([{ fields: { email: { stringValue: 'not-read@example.test' } } }], 1000));
  assert.throws(() => assertInvitationPreflight({ ...summary(approval.projectId), tokenReads: 1 }, approval.projectId));
});
test('live read requests only status/expiry, preserves pagination and rejects foreign documents', async () => {
  const calls = [], client = { get: async (name, options) => { calls.push([name, options]); return { body: calls.length === 1 ? { documents: [], nextPageToken: 'next' } : { documents: [] } }; } };
  const result = await readMaskedInvitations(client, () => 1000); assert.equal(result.total, 0); assert.equal(result.pages, 2);
  for (const [name, options] of calls) { assert.equal(name, 'projects/filmovy-kviz-v2-staging/databases/(default)/documents/accessInvites'); assert.deepEqual(options.queryParams.getAll('mask.fieldPaths'), ['status', 'expiresAt']); }
  assert.equal(calls[1][1].queryParams.get('pageToken'), 'next');
  await assert.rejects(readMaskedInvitations({ get: async () => ({ body: { documents: [{ name: 'projects/foreign/accessInvites/a' }] } }) }));
});
test('reused REST adapter permits exact writes only, fixes paths and disables retries', async () => {
  const plan = enablePlan(approval), calls = [], store = pauseStore(plan, { post: async (...v) => calls.push(v), get: async () => { throw { status: 404 }; } });
  await store.commit(plan.writes); assert.deepEqual(calls[0][2], { retries: 0 }); await assert.rejects(store.commit([])); await assert.rejects(store.read('foreign')); assert.equal(await store.read(plan.auditName), null);
});
