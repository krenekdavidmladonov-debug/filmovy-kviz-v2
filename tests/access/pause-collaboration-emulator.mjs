import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { executePause, pausePlan } from '../../tools/access/pause-collaboration-core.mjs';

const host = process.env.FIRESTORE_EMULATOR_HOST, projectId = process.env.GCLOUD_PROJECT;
assert.match(host ?? '', /^(localhost|127\.0\.0\.1):\d{2,5}$/u, 'Local Firestore emulator required');
assert.equal(projectId, 'demo-pause-collaboration', 'Dedicated synthetic demo project required');
assert(!process.env.GOOGLE_APPLICATION_CREDENTIALS && !process.env.FIREBASE_TOKEN, 'No cloud credentials permitted');
const origin = `http://${host}/v1/`, database = `projects/${projectId}/databases/(default)`, controlName = `${database}/documents/accessControl/state`;
async function request(name, data) {
  const response = await fetch(origin + name, { method: data ? 'POST' : 'GET', headers: { 'content-type': 'application/json', authorization: 'Bearer owner' }, body: data ? JSON.stringify(data) : undefined });
  if (response.status === 404 && !data) return null;
  const body = await response.json();
  assert(response.ok, `Emulator status ${response.status}: ${body.error?.status}`);
  return body;
}
let commitCount = 0;
const store = { read: name => request(name), commit: writes => { commitCount++; return request(`${database}/documents:commit`, { writes }); } };
async function fresh() {
  await store.commit([{ update: { name: controlName, fields: { collaborationEnabled: { booleanValue: true }, revision: { integerValue: '18' }, sentinel: { stringValue: 'untouched' } } } }]);
  const control = await store.read(controlName);
  const approval = { projectId, releaseSha: 'd'.repeat(40), expectedRevision: 18, expectedUpdateTime: control.updateTime,
    operatorEmail: 'operator@example.test', approvedBy: 'synthetic-emulator', approvalReference: randomUUID() };
  return { approval, plan: pausePlan(approval) };
}
assert.equal(await store.read(controlName), null, 'Dedicated emulator state must start empty');
const first = await fresh();
assert.equal((await executePause({ approval: first.approval, store })).mode, 'DRY_RUN');
assert.equal((await executePause({ approval: first.approval, store, apply: true, confirmPlanSha256: first.plan.planSha256 })).mode, 'APPLIED');
assert.equal((await store.read(controlName)).fields.sentinel.stringValue, 'untouched');
const count = commitCount;
assert.equal((await executePause({ approval: first.approval, store, apply: true, confirmPlanSha256: first.plan.planSha256 })).mode, 'ALREADY_APPLIED');
assert.equal(commitCount, count);

const stale = await fresh();
await assert.rejects(executePause({ approval: stale.approval, store, apply: true, confirmPlanSha256: stale.plan.planSha256,
  beforeCommit: async () => { await store.commit([{ update: { name: controlName, fields: { revision: { integerValue: '19' } } }, updateMask: { fieldPaths: ['revision'] } }]); } }));
assert.equal(await store.read(stale.plan.auditName), null);
assert.equal((await store.read(controlName)).fields.collaborationEnabled.booleanValue, true);

const duplicate = await fresh();
await store.commit([duplicate.plan.writes[1]]);
await assert.rejects(store.commit(duplicate.plan.writes));
assert.equal((await store.read(controlName)).fields.collaborationEnabled.booleanValue, true, 'Audit create conflict must roll back control update');

const lost = await fresh();
const uncertain = { ...store, commit: async writes => { await store.commit(writes); throw Error('synthetic lost response'); } };
await assert.rejects(executePause({ approval: lost.approval, store: uncertain, apply: true, confirmPlanSha256: lost.plan.planSha256 }), /lost response/u);
const afterLost = commitCount;
assert.equal((await executePause({ approval: lost.approval, store })).mode, 'ALREADY_APPLIED');
assert.equal(commitCount, afterLost);
console.log('PASS: real emulator atomic CAS, audit collision rollback, sentinel preservation, dry-run/replay and lost-response recovery.');
