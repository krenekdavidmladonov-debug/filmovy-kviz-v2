import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createFunctionDeploymentPolicy,deploymentInputHash,FUNCTION_ORDER,FUNCTION_PROJECT,FUNCTION_REGION,
  ARTIFACT_SOURCE,ARTIFACT_RECEIPT} from './function-deployment-policy.mjs';

const NOW = Date.parse('2026-10-14T09:00:00.000Z'), iso = at => new Date(at).toISOString();
const PREFIX = `projects/${FUNCTION_PROJECT}/locations/${FUNCTION_REGION}`;
const URL = 'https://cloudfunctions.googleapis.com/v2/';
const builder = 'projects/177615774316/serviceAccounts/177615774316-compute@developer.gserviceaccount.com';
const oldAccount = '177615774316-compute@developer.gserviceaccount.com';
const secretNames = ['EMAIL_TOKEN_KEYRING','GMAIL_OAUTH_CLIENT_ID','GMAIL_OAUTH_CLIENT_SECRET','GMAIL_OAUTH_REFRESH_TOKEN'];
const clone = value => JSON.parse(JSON.stringify(value));
const req = (method,url,body = null) => ({method,url,body,redirect:'error'});
const managed = (id,generation) => ({bucket:'gcf-v2-sources-177615774316-europe-west1',object:id + '/function-source.zip',generation});
const masks = ['buildConfig.runtime','buildConfig.entryPoint','buildConfig.source.storageSource','buildConfig.environmentVariables',
  'serviceConfig.environmentVariables','serviceConfig.secretEnvironmentVariables'];
function rebind(input) {
  input.approval.descriptorSha256 = deploymentInputHash(input.descriptor);
  input.approval.beforeSha256 = deploymentInputHash(input.before);
  input.approval.targetsSha256 = deploymentInputHash(input.targets);
  return input;
}
function fixture() {
  const descriptor = {cutoff:iso(NOW),allowedRecipient:'synthetic-recipient@example.test',senderEmail:'synthetic-sender@example.test',
    publicOrigin:'https://filmovy-kviz-v2-staging.web.app',secretVersions:Object.fromEntries(secretNames.map(name => [name,'1'])),
    triggerRegion:FUNCTION_REGION,buildServiceAccount:builder};
  const common = {REGISTRATION_EMAIL_MODE:'staging',REGISTRATION_EMAIL_ACTIVATED_AT:descriptor.cutoff,
    REGISTRATION_EMAIL_ALLOWED_RECIPIENT:descriptor.allowedRecipient};
  const before = FUNCTION_ORDER.map((id,index) => ({id,exists:index >= 2,state:index >= 2 ? 'ACTIVE' : 'NOT_FOUND',observedAt:iso(NOW),
    sourceRevision:index >= 2 ? `projects/177615774316/locations/europe-west1/builds/old-${index}` : null,
    body:index < 2 ? null : {name:PREFIX + '/functions/' + id,environment:'GEN_2',labels:{'deployment-callable':'true','kept-label':'kept'},
      buildConfig:{runtime:'nodejs22',entryPoint:id,environmentVariables:{KEPT_BUILD:'kept'},serviceAccount:builder,source:{storageSource:managed(id,'1')}},
      serviceConfig:{environmentVariables:{GCLOUD_PROJECT:FUNCTION_PROJECT,FIREBASE_CONFIG:JSON.stringify({projectId:FUNCTION_PROJECT}),FUNCTION_REGION:FUNCTION_REGION,
        FUNCTION_TARGET:id,LOG_EXECUTION_ID:'true',FUNCTION_SIGNATURE_TYPE:'http',KEPT_SETTING:'kept'},
        serviceAccountEmail:oldAccount,secretEnvironmentVariables:[],availableMemory:'256Mi',maxInstanceCount:10}}}));
  const targets = FUNCTION_ORDER.map((id,index) => {
    const body = index < 2 ? {name:PREFIX + '/functions/' + id,environment:'GEN_2',labels:id === 'deliverEmailTask' ? {'deployment-taskqueue':'true'} : {},
      buildConfig:{runtime:'nodejs22',entryPoint:id,environmentVariables:{GOOGLE_NODE_RUN_SCRIPTS:''},serviceAccount:builder},
      serviceConfig:{environmentVariables:{...common},secretEnvironmentVariables:[],serviceAccountEmail:''}} : clone(before[index].body);
    delete body.buildConfig.source;
    body.serviceConfig.environmentVariables = {...body.serviceConfig.environmentVariables,...common};
    const suffix = index === 0 ? 'worker' : index === 1 ? 'dispatch' : 'create';
    body.serviceConfig.serviceAccountEmail = index < 3 ? `registration-email-${suffix}@${FUNCTION_PROJECT}.iam.gserviceaccount.com` : oldAccount;
    const required = index === 0 ? secretNames : index === 2 ? ['EMAIL_TOKEN_KEYRING'] : [];
    body.serviceConfig.secretEnvironmentVariables = required.map(name => ({key:name,secret:name,projectId:FUNCTION_PROJECT,version:'1'}));
    if (index === 0) { body.serviceConfig.timeoutSeconds = 60; Object.assign(body.serviceConfig.environmentVariables,
      {EMAIL_PUBLIC_ORIGIN:descriptor.publicOrigin,GMAIL_SENDER_EMAIL:descriptor.senderEmail}); }
    if (index === 1) body.eventTrigger = {eventType:'google.cloud.firestore.document.v1.created',retryPolicy:'RETRY_POLICY_RETRY',
      serviceAccountEmail:body.serviceConfig.serviceAccountEmail,triggerRegion:FUNCTION_REGION,eventFilters:[
        {attribute:'database',value:'(default)'},{attribute:'namespace',value:'(default)'},
        {attribute:'document',value:'events/{eventId}/emailIntents/{intentId}',operator:'match-path-pattern'}]};
    return {id,method:index < 2 ? 'POST' : 'PATCH',updateMask:index < 2 ? null : [...masks,...(index === 2 ? ['serviceConfig.serviceAccountEmail'] : [])].sort(),body};
  });
  return rebind({descriptor,before,targets,sourceBinding:{archiveSha256:'a'.repeat(64),uploadReceiptSha256:'b'.repeat(64),
    storageSource:{bucket:'synthetic-upload-bucket',object:'synthetic-upload.zip',generation:'0'}},
    approval:{mode:'APPROVED_EMAIL_FIVE_FUNCTIONS',projectId:FUNCTION_PROJECT,region:FUNCTION_REGION,artifactSourceSha:ARTIFACT_SOURCE,
      artifactReceiptSha256:ARTIFACT_RECEIPT,archiveSha256:'a'.repeat(64),descriptorSha256:'',beforeSha256:'',targetsSha256:'',
      approvalReference:'synthetic-approval',operatorReference:'synthetic-operator',issuedAt:iso(NOW - 1000),expiresAt:iso(NOW + 60 * 60_000 - 1000)}});
}
const create = input => createFunctionDeploymentPolicy(input ?? fixture(),'synthetic-operator',NOW);
function fresh(policy,input,index,at = NOW) {
  policy.authorize(req('GET',URL + PREFIX + '/functions/' + FUNCTION_ORDER[index]),at);
  policy.acceptBefore({...clone(input.before[index]),observedAt:iso(at)},at);
}
function wire(input,index) {
  const target = input.targets[index], body = clone(target.body);
  body.buildConfig.source = {storageSource:clone(input.sourceBinding.storageSource)};
  return req(target.method,index < 2 ? URL + PREFIX + '/functions?functionId=' + target.id
    : URL + PREFIX + '/functions/' + target.id + '?updateMask=' + target.updateMask.join(','),body);
}
function op(index,done = true) {
  return {name:PREFIX + '/operations/operation-' + index,target:PREFIX + '/functions/' + FUNCTION_ORDER[index],done,failed:false,
    build:done ? 'projects/177615774316/locations/europe-west1/builds/new-' + index : null};
}
function readback(input,index) {
  const body = clone(input.targets[index].body); body.buildConfig.source = {storageSource:managed(FUNCTION_ORDER[index],'2')};
  return {id:FUNCTION_ORDER[index],state:'ACTIVE',body,service:PREFIX + '/services/' + FUNCTION_ORDER[index].toLowerCase(),
    build:op(index).build,sourceProvenance:{resolvedStorageSource:managed(FUNCTION_ORDER[index],'2')}};
}
function complete(policy,input,index,at = NOW) {
  fresh(policy,input,index,at); policy.authorize(wire(input,index),at); policy.acceptOperation(op(index),at);
  policy.authorize(req('GET',URL + PREFIX + '/functions/' + FUNCTION_ORDER[index]),at); policy.acceptReadback(readback(input,index),at);
}

test('ordered exact two creates and three updates accept managed source/provenance and preserve settings', () => {
  for (const generation of ['0',undefined]) {
    const input = fixture();
    if (generation === undefined) delete input.sourceBinding.storageSource.generation;
    const policy = create(input);
    for (let index = 0; index < 5; index++) complete(policy,input,index);
    assert.equal(policy.status(NOW).complete,true);
    assert.equal(policy.status(NOW).completedTargets,5);
  }
});

test('closed approval and descriptor bindings reject forged identity, classification, aliases and changed settings', () => {
  for (const change of [x => { x.extra = true; },x => { x.approval.projectId = 'production'; },
    x => { x.approval.artifactReceiptSha256 = 'c'.repeat(64); },x => { x.approval.operatorReference = 'other-operator'; },
    x => { x.approval.expiresAt = iso(NOW); },x => { x.before[0].exists = true; },
    x => { x.before[2].state = 'FAILED'; },x => { x.before[2].observedAt = iso(NOW - 300001); },
    x => { x.descriptor.secretVersions.GMAIL_OAUTH_REFRESH_TOKEN = 'latest'; },
    x => { x.targets[0].body.serviceConfig.secretEnvironmentVariables[0].version = '2'; },
    x => { x.targets[1].body.eventTrigger.eventFilters[2].value = 'events/{eventId}/teams/{teamId}'; },
    x => { x.targets[0].body.serviceConfig.serviceAccountEmail = oldAccount; },
    x => { x.targets[2].body.serviceConfig.maxInstanceCount = 11; },
    x => { delete x.targets[2].body.serviceConfig.environmentVariables.KEPT_SETTING; },
    x => { x.targets[3].body.labels['kept-label'] = 'changed'; },
    x => { x.targets[2].body.buildConfig.serviceAccount = 'projects/177615774316/serviceAccounts/unknown@example.iam.gserviceaccount.com'; },
    x => { x.targets[0].body.buildConfig.serviceAccount = 'projects/177615774316/serviceAccounts/unknown@example.iam.gserviceaccount.com'; },
    x => { x.targets[3].updateMask.push('serviceConfig.serviceAccountEmail'); },
    x => { x.targets[2].updateMask = ['buildConfig.runtime']; },
    x => { x.targets[0].body.serviceConfig.environmentVariables.GMAIL_OAUTH_CLIENT_SECRET = 'synthetic-secret'; },
    x => { x.targets[0].body.serviceConfig.environmentVariables.GCLOUD_PROJECT = 'production'; },
    x => { x.targets[0].body.serviceConfig.environmentVariables.FIREBASE_CONFIG = JSON.stringify({projectId:'production'}); },
    x => { x.sourceBinding.archiveSha256 = 'c'.repeat(64); },
    x => { x.sourceBinding.uploadUrl = 'https://foreign.test/upload'; }]) {
    const input = fixture(); change(input); rebind(input); assert.throws(() => create(input),/^Error: FUNCTION_POLICY_/u);
  }
  const changed = fixture(); changed.descriptor.allowedRecipient = 'other@example.test';
  assert.throws(() => create(changed),/^Error: FUNCTION_POLICY_BINDING$/u);
});

test('real request gate rejects hidden side effects, extra queries, source substitution and out-of-order writes', () => {
  for (const change of [r => { r.method = 'DELETE'; },r => { r.url = URL + PREFIX + '/functions?functionId=otherFunction'; },
    r => { r.url += '&extra=true'; },r => { r.url = URL + PREFIX + '/functions:generateUploadUrl'; },
    r => { r.method = 'PUT'; r.url = 'https://storage.googleapis.com/foreign/object.zip'; },
    r => { r.url = 'https://serviceusage.googleapis.com/v1/projects/177615774316/services/pubsub.googleapis.com:enable'; },
    r => { r.url = 'https://cloudresourcemanager.googleapis.com/v1/projects/filmovy-kviz-v2-staging:setIamPolicy'; },
    r => { r.url = 'https://cloudtasks.googleapis.com/v2/projects/filmovy-kviz-v2-staging/locations/europe-west1/queues/deliverEmailTask:resume'; },
    r => { r.redirect = 'follow'; },r => { r.body.buildConfig.source.storageSource.object = 'substituted.zip'; },
    r => { r.body.serviceConfig.extra = true; },r => { r.body.serviceConfig.environmentVariables.REGISTRATION_EMAIL_ALLOWED_RECIPIENT = 'other@example.test'; }]) {
    const input = fixture(), policy = create(input); fresh(policy,input,0);
    const request = wire(input,0); change(request); assert.throws(() => policy.authorize(request,NOW),/^Error: FUNCTION_POLICY_/u);
    assert.throws(() => policy.status(NOW),/^Error: FUNCTION_POLICY_STOPPED$/u);
  }
  const input = fixture(), policy = create(input); fresh(policy,input,0);
  assert.throws(() => policy.authorize(wire(input,1),NOW),/^Error: FUNCTION_POLICY_REQUEST$/u);
});

test('fresh before-state, single attempt, expiry and immutable inputs constrain writes before transport', () => {
  const input = fixture(), policy = create(input); fresh(policy,input,0);
  policy.authorize(wire(input,0),NOW);
  assert.throws(() => policy.authorize(wire(input,0),NOW),/^Error: FUNCTION_POLICY_REQUEST$/u);
  const drift = create(input); drift.authorize(req('GET',URL + PREFIX + '/functions/' + FUNCTION_ORDER[0]),NOW);
  assert.throws(() => drift.acceptBefore({...input.before[0],exists:true},NOW),/^Error: FUNCTION_POLICY_DRIFT$/u);
  const stale = create(input); fresh(stale,input,0);
  assert.throws(() => stale.authorize(wire(input,0),NOW + 300001),/^Error: FUNCTION_POLICY_REQUEST$/u);
  const expired = create(input); assert.throws(() => expired.status(NOW + 3600000),/^Error: FUNCTION_POLICY_EXPIRED$/u);
  const immutable = create(input); input.targets[0].body.serviceConfig.timeoutSeconds = 999;
  fresh(immutable,input,0); assert.throws(() => immutable.authorize(wire(input,0),NOW),/^Error: FUNCTION_POLICY_REQUEST$/u);
});

test('returned operations are target scoped, bound once, spaced and bounded', () => {
  for (const change of [value => { value.name = 'projects/foreign/locations/europe-west1/operations/id'; },
    value => { value.name += '?extra=true'; },value => { value.target = PREFIX + '/functions/otherFunction'; },
    value => { value.failed = true; },value => { value.build = 'projects/foreign/locations/europe-west1/builds/id'; }]) {
    const input = fixture(), policy = create(input); fresh(policy,input,0); policy.authorize(wire(input,0),NOW);
    const value = op(0); change(value); assert.throws(() => policy.acceptOperation(value,NOW),/^Error: FUNCTION_POLICY_/u);
  }
  const input = fixture(), early = create(input); fresh(early,input,0); early.authorize(wire(input,0),NOW); early.acceptOperation(op(0,false),NOW);
  assert.throws(() => early.authorize(req('GET',URL + op(0).name),NOW + 4999),/^Error: FUNCTION_POLICY_PHASE$/u);
  const bounded = create(input); fresh(bounded,input,0); bounded.authorize(wire(input,0),NOW); bounded.acceptOperation(op(0,false),NOW);
  for (let i = 1; i <= 120; i++) {
    bounded.authorize(req('GET',URL + op(0).name),NOW + i * 5000); bounded.acceptOperation(op(0,false),NOW + i * 5000);
  }
  assert.throws(() => bounded.authorize(req('GET',URL + op(0).name),NOW + 605000),/^Error: FUNCTION_POLICY_PHASE$/u);
});

test('managed source readback rejects counterfeit build, source, provenance, settings and old unchanged update', () => {
  for (const change of [value => { value.build = 'projects/177615774316/locations/europe-west1/builds/other'; },
    value => { value.body.buildConfig.source.storageSource.object = 'otherFunction/function-source.zip'; },
    value => { value.sourceProvenance.resolvedStorageSource.generation = '999'; },
    value => { value.body.serviceConfig.environmentVariables.REGISTRATION_EMAIL_MODE = 'off'; },
    value => { value.service = PREFIX + '/services/other'; }]) {
    const input = fixture(), policy = create(input); fresh(policy,input,0); policy.authorize(wire(input,0),NOW); policy.acceptOperation(op(0),NOW);
    policy.authorize(req('GET',URL + PREFIX + '/functions/' + FUNCTION_ORDER[0]),NOW);
    const value = readback(input,0); change(value); assert.throws(() => policy.acceptReadback(value,NOW),/^Error: FUNCTION_POLICY_/u);
  }
  const input = fixture(), policy = create(input); complete(policy,input,0); complete(policy,input,1); fresh(policy,input,2);
  policy.authorize(wire(input,2),NOW); policy.acceptOperation({...op(2),build:input.before[2].sourceRevision},NOW);
  policy.authorize(req('GET',URL + PREFIX + '/functions/' + FUNCTION_ORDER[2]),NOW);
  const unchanged = readback(input,2); unchanged.build = input.before[2].sourceRevision;
  assert.throws(() => policy.acceptReadback(unchanged,NOW),/^Error: FUNCTION_POLICY_SOURCE$/u);
});
