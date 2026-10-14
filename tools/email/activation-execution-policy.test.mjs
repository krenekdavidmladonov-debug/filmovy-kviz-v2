import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createApiEnablePolicy, API_PROJECT, API_PROJECT_NUMBER, API_SERVICES} from './activation-execution-policy.mjs';

const NOW = Date.parse('2026-10-14T08:00:00.000Z');
const iso = at => new Date(at).toISOString();
const name = service => `projects/${API_PROJECT_NUMBER}/services/${service}`;
const url = service => 'https://serviceusage.googleapis.com/v1/' + name(service);
const request = (method, target, body = null) => ({method, url:target, body, redirect:'error'});
const evidence = (service, state = 'DISABLED', at = NOW) => ({name:name(service), state, observedAt:iso(at)});
function approval() {
  return {schemaVersion:1, mode:'APPROVED_EMAIL_TWO_API_ENABLE', projectId:API_PROJECT,
    projectNumber:API_PROJECT_NUMBER, approvalReference:'synthetic-approval', operatorReference:'synthetic-operator',
    issuedAt:iso(NOW - 1000), expiresAt:iso(NOW + 10 * 60_000), allowAlreadyEnabled:false,
    before:API_SERVICES.map(service => evidence(service))};
}
const create = value => createApiEnablePolicy(value ?? approval(), 'synthetic-operator', NOW);
function fresh(policy, service, state = 'DISABLED', at = NOW) {
  assert.equal(policy.authorize(request('GET', url(service)), at).kind, 'fresh-read');
  policy.acceptService(service, evidence(service, state, at), at);
}
function enable(policy, service, at = NOW) {
  fresh(policy, service, 'DISABLED', at);
  assert.deepEqual(policy.authorize(request('POST', url(service) + ':enable', {}), at), {kind:'api-enable', service});
}

test('exact two enablements require fresh reads, bound operation and enabled readbacks', () => {
  const policy = create();
  for (const [index, service] of API_SERVICES.entries()) {
    enable(policy, service, NOW + index * 10_000);
    // Service Usage returns opaque single-segment IDs including a literal dot.
    const operation = `operations/acf.p2-177615774316-synthetic-${index}`;
    policy.acceptOperation(service, {name:operation, done:false, failed:false}, NOW + index * 10_000);
    const at = NOW + index * 10_000 + 5000;
    assert.equal(policy.authorize(request('GET', 'https://serviceusage.googleapis.com/v1/' + operation), at).kind, 'operation-read');
    policy.acceptOperation(service, {name:operation, done:true, failed:false}, at);
    assert.equal(policy.authorize(request('GET', url(service)), at).kind, 'enabled-readback');
    policy.acceptService(service, evidence(service, 'ENABLED', at), at);
  }
  const status = policy.status(NOW + 15_000);
  assert.equal(status.complete, true);
  assert.deepEqual(status.services.map(s => s.phase), ['complete', 'complete']);
  assert.ok(!JSON.stringify(status).includes('synthetic-operator'));
});

test('fresh already-enabled skip requires explicit coverage and makes no write allowance', () => {
  const covered = approval(); covered.allowAlreadyEnabled = true;
  const policy = create(covered);
  for (const service of API_SERVICES) fresh(policy, service, 'ENABLED');
  assert.equal(policy.status(NOW).complete, true);
  assert.throws(() => policy.authorize(request('POST', url(API_SERVICES[0]) + ':enable', {}), NOW), /API_POLICY_PHASE/u);
  const rejected = create();
  assert.throws(() => fresh(rejected, API_SERVICES[0], 'ENABLED'), /API_POLICY_DRIFT/u);
});

test('approval rejects unknown fields, missing authority, foreign scope and stale evidence', () => {
  for (const mutate of [a => { a.extra = true; }, a => { delete a.approvalReference; },
    a => { a.projectId = 'production'; }, a => { a.projectNumber = '999'; },
    a => { a.operatorReference = 'other-operator'; }, a => { a.before[0].state = 'ENABLED'; },
    a => { a.before[0].observedAt = iso(NOW - 300001); }, a => { a.before[0].observedAt = iso(NOW + 1); },
    a => { a.before[0].extra = true; }, a => { a.before.reverse(); }, a => { a.before.pop(); },
    a => { a.expiresAt = iso(NOW); }, a => { a.issuedAt = iso(NOW + 1); },
    a => { a.expiresAt = iso(NOW + 30 * 60_000); }, a => { a.issuedAt = '2026-02-30T08:00:00.000Z'; },
    a => { a.allowAlreadyEnabled = 'true'; }, a => { a.approvalReference = 'secret\nvalue'; }]) {
    const value = approval(); mutate(value); assert.throws(() => create(value));
  }
});

test('request boundary denies extra APIs, IAM, identities, batch, deletion, redirects and query expansion', () => {
  for (const bad of [request('POST', 'https://serviceusage.googleapis.com/v1/projects/177615774316/services/pubsub.googleapis.com:enable', {}),
    request('POST', url(API_SERVICES[0]) + ':disable', {}), request('POST', url(API_SERVICES[0]) + ':generateServiceIdentity', {}),
    request('POST', 'https://serviceusage.googleapis.com/v1/projects/177615774316/services:batchEnable', {}),
    request('POST', 'https://cloudresourcemanager.googleapis.com/v1/projects/filmovy-kviz-v2-staging:setIamPolicy', {}),
    request('DELETE', url(API_SERVICES[0])), request('GET', url(API_SERVICES[0]) + '?fields=state'),
    request('GET', url(API_SERVICES[0]).replace('https:', 'http:')),
    request('GET', url(API_SERVICES[0]).replace('177615774316', '999')),
    {...request('GET', url(API_SERVICES[0])), redirect:'follow'},
    {...request('GET', url(API_SERVICES[0])), unknown:true},
    request('POST', url(API_SERVICES[0]) + ':enable', {extra:true})]) {
    const policy = create();
    assert.throws(() => policy.authorize(bad, NOW));
    assert.throws(() => policy.authorize(request('GET', url(API_SERVICES[0])), NOW), /API_POLICY_STOPPED/u);
  }
});

test('single attempt is consumed before transport and cannot retry uncertain enables', () => {
  const service = API_SERVICES[0], policy = create(); enable(policy, service);
  assert.throws(() => policy.authorize(request('POST', url(service) + ':enable', {}), NOW), /API_POLICY_PHASE/u);
  const withoutFresh = create();
  assert.throws(() => withoutFresh.authorize(request('POST', url(service) + ':enable', {}), NOW), /API_POLICY_PHASE/u);
  const stale = create(); fresh(stale, service);
  assert.throws(() => stale.authorize(request('POST', url(service) + ':enable', {}), NOW + 300001), /API_POLICY_PHASE/u);
});

test('operation pointers are only admitted after enable and cannot expand or change', () => {
  const service = API_SERVICES[0];
  const premature = create();
  assert.throws(() => premature.acceptOperation(service, {name:'operations/synthetic', done:true, failed:false}, NOW), /API_POLICY_PHASE/u);
  for (const bad of [{name:'operations/../foreign', done:false, failed:false},
    {name:'operations/..', done:false, failed:false}, {name:'operations/acf.p2/foreign', done:false, failed:false},
    {name:'operations/acf%2ep2', done:false, failed:false},
    {name:'https://foreign.test/operations/id', done:false, failed:false},
    {name:'operations/id?query=1', done:false, failed:false}, {name:'operations/id', done:true, failed:true},
    {name:'operations/id', done:true, failed:false, extra:'synthetic-provider-error'}]) {
    const policy = create(); enable(policy, service);
    assert.throws(() => policy.acceptOperation(service, bad, NOW));
  }
  const changed = create(); enable(changed, service);
  changed.acceptOperation(service, {name:'operations/first', done:false, failed:false}, NOW);
  changed.authorize(request('GET', 'https://serviceusage.googleapis.com/v1/operations/first'), NOW + 5000);
  assert.throws(() => changed.acceptOperation(service, {name:'operations/second', done:true, failed:false}, NOW + 5000), /API_POLICY_OPERATION/u);
  const duplicate = create();
  for (const item of API_SERVICES) enable(duplicate, item);
  duplicate.acceptOperation(service, {name:'operations/shared', done:false, failed:false}, NOW);
  assert.throws(() => duplicate.acceptOperation(API_SERVICES[1], {name:'operations/shared', done:false, failed:false}, NOW), /API_POLICY_OPERATION/u);
});

test('polls have spacing and finite budget; failed readback and expiry stop', () => {
  const service = API_SERVICES[0], op = {name:'operations/synthetic', done:false, failed:false};
  const early = create(); enable(early, service); early.acceptOperation(service, op, NOW);
  assert.throws(() => early.authorize(request('GET', 'https://serviceusage.googleapis.com/v1/' + op.name), NOW + 4999), /API_POLICY_PHASE/u);
  const bounded = create(); enable(bounded, service); bounded.acceptOperation(service, op, NOW);
  for (let i = 1; i <= 12; i++) {
    bounded.authorize(request('GET', 'https://serviceusage.googleapis.com/v1/' + op.name), NOW + i * 5000);
    bounded.acceptOperation(service, op, NOW + i * 5000);
  }
  assert.throws(() => bounded.authorize(request('GET', 'https://serviceusage.googleapis.com/v1/' + op.name), NOW + 65000), /API_POLICY_PHASE/u);
  const readback = create(); enable(readback, service);
  readback.acceptOperation(service, {...op, done:true}, NOW);
  readback.authorize(request('GET', url(service)), NOW);
  assert.throws(() => readback.acceptService(service, evidence(service), NOW), /API_POLICY_READBACK/u);
  const expired = create();
  assert.throws(() => expired.authorize(request('GET', url(service)), NOW + 10 * 60_000), /API_POLICY_EXPIRED/u);
  const backwards = create(); backwards.status(NOW + 1);
  assert.throws(() => backwards.status(NOW), /API_POLICY_EXPIRED/u);
});

test('mutable approval cannot expand scope or extend lifetime after creation', () => {
  const value = approval(), policy = create(value);
  value.allowAlreadyEnabled = true; value.expiresAt = iso(NOW + 100 * 60_000);
  value.before[0].name = 'projects/foreign/services/extra.googleapis.com';
  assert.throws(() => fresh(policy, API_SERVICES[0], 'ENABLED'), /API_POLICY_DRIFT/u);
});
