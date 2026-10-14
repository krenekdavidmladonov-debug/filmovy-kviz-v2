// Pure GCFv2 request boundary only. No Auth, network, IAM, provisioning or CLI.
// Source upload is a separate adapter: it must verify the immutable archive,
// exact GCF-returned signed capability, uploaded bytes and returned storageSource.
// This policy NEVER authorizes upload/generateUploadUrl requests. Its trusted
// sourceBinding input is the successful upload receipt, not an origin validator.
import {createHash} from 'node:crypto';

export const FUNCTION_PROJECT = 'filmovy-kviz-v2-staging', FUNCTION_REGION = 'europe-west1';
export const ARTIFACT_SOURCE = 'f19c54dab8afaaf88a4d2b5a44d066174fe8165e';
export const ARTIFACT_RECEIPT = 'e45b7036cdaccc789ab8d9b6b20403a3bd1760a7ead688d7f18ab2055c96b3c3';
export const FUNCTION_ORDER = Object.freeze(['deliverEmailTask','dispatchRegistrationEmail',
  'createEventRegistration','updateEventRegistration','cancelEventRegistration']);
const PREFIX = `projects/${FUNCTION_PROJECT}/locations/${FUNCTION_REGION}`;
const ORIGIN = 'https://cloudfunctions.googleapis.com/v2/';
const SECRET_NAMES = ['EMAIL_TOKEN_KEYRING','GMAIL_OAUTH_CLIENT_ID','GMAIL_OAUTH_CLIENT_SECRET','GMAIL_OAUTH_REFRESH_TOKEN'];
const accounts = {
  deliverEmailTask:`registration-email-worker@${FUNCTION_PROJECT}.iam.gserviceaccount.com`,
  dispatchRegistrationEmail:`registration-email-dispatch@${FUNCTION_PROJECT}.iam.gserviceaccount.com`,
  createEventRegistration:`registration-email-create@${FUNCTION_PROJECT}.iam.gserviceaccount.com`,
  updateEventRegistration:'177615774316-compute@developer.gserviceaccount.com',
  cancelEventRegistration:'177615774316-compute@developer.gserviceaccount.com'
};
const SERVICE_KEYS = ['environmentVariables','secretEnvironmentVariables','serviceAccountEmail','timeoutSeconds',
  'availableMemory','minInstanceCount','maxInstanceCount','maxInstanceRequestConcurrency','availableCpu','ingressSettings','allTrafficOnLatestRevision'];
const BUILD_PRESERVE = ['dockerRepository','dockerRegistry','automaticUpdatePolicy'];
const MASKS = ['buildConfig.runtime','buildConfig.entryPoint','buildConfig.source.storageSource','buildConfig.environmentVariables',
  'serviceConfig.environmentVariables','serviceConfig.secretEnvironmentVariables'];
const need = (condition, code) => { if (!condition) throw Error(code); };
function keys(value, allowed, required = allowed) {
  need(value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype
    && Reflect.ownKeys(value).every(key => typeof key === 'string' && allowed.includes(key))
    && required.every(key => Object.hasOwn(value,key)), 'FUNCTION_POLICY_SHAPE');
}
function utc(value) {
  need(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value), 'FUNCTION_POLICY_TIME');
  const parsed = Date.parse(value);
  need(Number.isFinite(parsed) && new Date(parsed).toISOString() === value, 'FUNCTION_POLICY_TIME'); return parsed;
}
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value !== null && typeof value === 'object') {
    need(Object.getPrototypeOf(value) === Object.prototype && Reflect.ownKeys(value).every(key => typeof key === 'string'), 'FUNCTION_POLICY_SHAPE');
    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  }
  need(value === null || ['string','boolean'].includes(typeof value) || (typeof value === 'number' && Number.isFinite(value)), 'FUNCTION_POLICY_SHAPE');
  return JSON.stringify(value);
}
export const deploymentInputHash = value => createHash('sha256').update(canonical(value)).digest('hex');
const equal = (a,b) => canonical(a) === canonical(b);
const resource = id => `${PREFIX}/functions/${id}`;
function stringMap(value) {
  need(value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype
    && Reflect.ownKeys(value).every(key => typeof key === 'string' && /^[A-Za-z_][A-Za-z0-9_-]{0,127}$/u.test(key)
      && typeof value[key] === 'string'), 'FUNCTION_POLICY_SHAPE');
}
function bodyShape(body, id) {
  keys(body,['name','environment','buildConfig','serviceConfig','labels','eventTrigger'],['name','environment','buildConfig','serviceConfig','labels']);
  need(body.name === resource(id) && body.environment === 'GEN_2', 'FUNCTION_POLICY_TARGET'); stringMap(body.labels);
  keys(body.buildConfig,['runtime','entryPoint','environmentVariables','serviceAccount','source',...BUILD_PRESERVE],['runtime','entryPoint','environmentVariables','serviceAccount']);
  need(body.buildConfig.runtime === 'nodejs22' && body.buildConfig.entryPoint === id, 'FUNCTION_POLICY_RUNTIME');
  stringMap(body.buildConfig.environmentVariables);
  keys(body.serviceConfig,SERVICE_KEYS,['environmentVariables','secretEnvironmentVariables','serviceAccountEmail']);
  stringMap(body.serviceConfig.environmentVariables);
  if (body.serviceConfig.environmentVariables.FIREBASE_CONFIG !== undefined) {
    let firebase;
    try { firebase = JSON.parse(body.serviceConfig.environmentVariables.FIREBASE_CONFIG); }
    catch { throw Error('FUNCTION_POLICY_CONFIG'); }
    need(firebase !== null && typeof firebase === 'object' && Object.getPrototypeOf(firebase) === Object.prototype
      && firebase.projectId === FUNCTION_PROJECT, 'FUNCTION_POLICY_CONFIG');
  }
  need(Array.isArray(body.serviceConfig.secretEnvironmentVariables), 'FUNCTION_POLICY_SECRET');
  for (const secret of body.serviceConfig.secretEnvironmentVariables) {
    keys(secret,['key','secret','projectId','version']);
    need(secret.projectId === FUNCTION_PROJECT && secret.key === secret.secret && SECRET_NAMES.includes(secret.secret)
      && /^[1-9]\d*$/u.test(secret.version), 'FUNCTION_POLICY_SECRET');
  }
  if (body.buildConfig.source !== undefined) {
    keys(body.buildConfig.source,['storageSource']); managedStorage(body.buildConfig.source.storageSource,id);
  }
}
function storage(value) {
  keys(value,['bucket','object','generation'],['bucket','object']);
  need(typeof value.bucket === 'string' && /^[a-z0-9][a-z0-9._-]{2,221}$/u.test(value.bucket)
    && typeof value.object === 'string' && /^[A-Za-z0-9_-]{1,200}\.zip$/u.test(value.object)
    && (value.generation === undefined || (typeof value.generation === 'string' && /^(?:0|[1-9]\d*)$/u.test(value.generation))), 'FUNCTION_POLICY_SOURCE');
}
function managedStorage(value,id) {
  keys(value,['bucket','object','generation']);
  need(value.bucket === 'gcf-v2-sources-177615774316-europe-west1' && value.object === id + '/function-source.zip'
    && typeof value.generation === 'string' && /^[1-9]\d*$/u.test(value.generation), 'FUNCTION_POLICY_SOURCE');
}
function buildPointer(value) {
  need(typeof value === 'string' && /^projects\/(?:filmovy-kviz-v2-staging|177615774316)\/locations\/europe-west1\/builds\/[A-Za-z0-9._-]{1,200}$/u.test(value), 'FUNCTION_POLICY_BUILD');
}

// Inputs are private, reviewed JSON projections. Future adapter obligations:
// authenticated HTTP success/404, actual operator identity, complete before-state
// projections (no discarded setting), LRO metadata.target/error projection, final
// actual Function config+source+service pointer projection, queue PAUSED and all
// prerequisite/IAM checks. A caller bypassing authorize is not guarded by import.
export function createFunctionDeploymentPolicy(input, operatorReference, now = Date.now()) {
  keys(input,['approval','descriptor','before','targets','sourceBinding']);
  const {approval,descriptor,before,targets,sourceBinding} = JSON.parse(canonical(input));
  keys(approval,['mode','projectId','region','artifactSourceSha','artifactReceiptSha256','archiveSha256',
    'descriptorSha256','beforeSha256','targetsSha256','approvalReference','operatorReference','issuedAt','expiresAt']);
  need(approval.mode === 'APPROVED_EMAIL_FIVE_FUNCTIONS' && approval.projectId === FUNCTION_PROJECT
    && approval.region === FUNCTION_REGION && approval.artifactSourceSha === ARTIFACT_SOURCE
    && approval.artifactReceiptSha256 === ARTIFACT_RECEIPT, 'FUNCTION_POLICY_SCOPE');
  for (const field of ['archiveSha256','descriptorSha256','beforeSha256','targetsSha256']) {
    need(typeof approval[field] === 'string' && /^[a-f0-9]{64}$/u.test(approval[field]), 'FUNCTION_POLICY_BINDING');
  }
  for (const field of ['approvalReference','operatorReference']) {
    need(typeof approval[field] === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:/-]{2,199}$/u.test(approval[field]), 'FUNCTION_POLICY_AUTHORITY');
  }
  need(operatorReference === approval.operatorReference, 'FUNCTION_POLICY_OPERATOR');
  const issued = utc(approval.issuedAt), expires = utc(approval.expiresAt);
  need(expires > issued && expires - issued <= 60 * 60_000, 'FUNCTION_POLICY_TIME');
  need(deploymentInputHash(descriptor) === approval.descriptorSha256 && deploymentInputHash(before) === approval.beforeSha256
    && deploymentInputHash(targets) === approval.targetsSha256, 'FUNCTION_POLICY_BINDING');
  keys(sourceBinding,['archiveSha256','uploadReceiptSha256','storageSource']); storage(sourceBinding.storageSource);
  need(sourceBinding.archiveSha256 === approval.archiveSha256 && /^[a-f0-9]{64}$/u.test(sourceBinding.uploadReceiptSha256), 'FUNCTION_POLICY_SOURCE');
  keys(descriptor,['cutoff','allowedRecipient','senderEmail','publicOrigin','secretVersions','triggerRegion','buildServiceAccount']); utc(descriptor.cutoff);
  need(descriptor.publicOrigin === 'https://filmovy-kviz-v2-staging.web.app' && descriptor.triggerRegion === FUNCTION_REGION, 'FUNCTION_POLICY_SCOPE');
  for (const field of ['allowedRecipient','senderEmail']) need(typeof descriptor[field] === 'string'
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(descriptor[field]), 'FUNCTION_POLICY_CONFIG');
  keys(descriptor.secretVersions,SECRET_NAMES);
  for (const version of Object.values(descriptor.secretVersions)) need(typeof version === 'string' && /^[1-9]\d*$/u.test(version), 'FUNCTION_POLICY_SECRET');
  need(Array.isArray(before) && before.length === 5 && Array.isArray(targets) && targets.length === 5, 'FUNCTION_POLICY_TARGET');
  need(typeof descriptor.buildServiceAccount === 'string'
    && /^projects\/(?:filmovy-kviz-v2-staging|177615774316)\/serviceAccounts\/[^\s/@]+@[^\s/]+\.gserviceaccount\.com$/u.test(descriptor.buildServiceAccount)
    && before.some(prior => prior.body?.buildConfig?.serviceAccount === descriptor.buildServiceAccount), 'FUNCTION_POLICY_BUILD');
  for (let index = 0; index < 5; index++) {
    const id = FUNCTION_ORDER[index], prior = before[index], desired = targets[index];
    keys(prior,['id','exists','state','observedAt','sourceRevision','body']);
    keys(desired,['id','method','updateMask','body']);
    need(prior.id === id && desired.id === id && prior.exists === (index >= 2)
      && prior.state === (index < 2 ? 'NOT_FOUND' : 'ACTIVE')
      && desired.method === (index < 2 ? 'POST' : 'PATCH'), 'FUNCTION_POLICY_CLASSIFICATION');
    const observed = utc(prior.observedAt); need(observed <= now && now - observed <= 5 * 60_000, 'FUNCTION_POLICY_STALE');
    if (index < 2) need(prior.body === null && prior.sourceRevision === null && desired.updateMask === null, 'FUNCTION_POLICY_CLASSIFICATION');
    else {
      bodyShape(prior.body,id);
      buildPointer(prior.sourceRevision);
      const allowed = [...MASKS,...(id === 'createEventRegistration' ? ['serviceConfig.serviceAccountEmail'] : [])];
      need(Array.isArray(desired.updateMask) && equal(desired.updateMask,[...allowed].sort()), 'FUNCTION_POLICY_MASK');
      // Whole maps replace in PATCH: preserve every unrelated environment key,
      // build key, label and service setting; only declared activation changes.
      need(equal(prior.body.labels,desired.body.labels), 'FUNCTION_POLICY_PRESERVE');
      need(equal(prior.body.buildConfig.environmentVariables,desired.body.buildConfig.environmentVariables), 'FUNCTION_POLICY_PRESERVE');
      need(prior.body.buildConfig.serviceAccount === desired.body.buildConfig.serviceAccount, 'FUNCTION_POLICY_PRESERVE');
      for (const key of BUILD_PRESERVE) need(equal(prior.body.buildConfig[key] ?? null,desired.body.buildConfig[key] ?? null), 'FUNCTION_POLICY_PRESERVE');
      for (const key of SERVICE_KEYS.filter(key => !['environmentVariables','secretEnvironmentVariables','serviceAccountEmail'].includes(key))) {
        need(equal(prior.body.serviceConfig[key] ?? null,desired.body.serviceConfig[key] ?? null), 'FUNCTION_POLICY_PRESERVE');
      }
      for (const [key,value] of Object.entries(prior.body.serviceConfig.environmentVariables)) {
        if (!['REGISTRATION_EMAIL_MODE','REGISTRATION_EMAIL_ACTIVATED_AT','REGISTRATION_EMAIL_ALLOWED_RECIPIENT'].includes(key)) {
          need(desired.body.serviceConfig.environmentVariables[key] === value, 'FUNCTION_POLICY_PRESERVE');
        }
      }
      need(Object.keys(desired.body.serviceConfig.environmentVariables).every(key => Object.hasOwn(prior.body.serviceConfig.environmentVariables,key)
        || ['REGISTRATION_EMAIL_MODE','REGISTRATION_EMAIL_ACTIVATED_AT','REGISTRATION_EMAIL_ALLOWED_RECIPIENT'].includes(key)), 'FUNCTION_POLICY_CONFIG');
    }
    bodyShape(desired.body,id);
    need(desired.body.buildConfig.source === undefined, 'FUNCTION_POLICY_SOURCE');
    const config = desired.body.serviceConfig, env = config.environmentVariables;
    need((env.GCLOUD_PROJECT === undefined || env.GCLOUD_PROJECT === FUNCTION_PROJECT)
      && (env.FUNCTION_REGION === undefined || env.FUNCTION_REGION === FUNCTION_REGION)
      && (env.FUNCTION_TARGET === undefined || env.FUNCTION_TARGET === id), 'FUNCTION_POLICY_CONFIG');
    if (index < 2) {
      need(desired.body.buildConfig.serviceAccount === descriptor.buildServiceAccount, 'FUNCTION_POLICY_BUILD');
      for (const key of BUILD_PRESERVE) if (desired.body.buildConfig[key] !== undefined) {
        need(before.some(prior => prior.body?.buildConfig && equal(prior.body.buildConfig[key] ?? null,desired.body.buildConfig[key])), 'FUNCTION_POLICY_BUILD');
      }
      need(Object.keys(env).every(key => ['REGISTRATION_EMAIL_MODE','REGISTRATION_EMAIL_ACTIVATED_AT','REGISTRATION_EMAIL_ALLOWED_RECIPIENT',
        'FUNCTION_TARGET','LOG_EXECUTION_ID','GCLOUD_PROJECT','FIREBASE_CONFIG','EVENTARC_CLOUD_EVENT_SOURCE','FUNCTION_REGION','FUNCTION_SIGNATURE_TYPE',
        ...(id === 'deliverEmailTask' ? ['EMAIL_PUBLIC_ORIGIN','GMAIL_SENDER_EMAIL'] : [])].includes(key)), 'FUNCTION_POLICY_CONFIG');
      need(Object.keys(desired.body.buildConfig.environmentVariables).every(key => key === 'GOOGLE_NODE_RUN_SCRIPTS'
        && desired.body.buildConfig.environmentVariables[key] === ''), 'FUNCTION_POLICY_CONFIG');
    }
    need(config.serviceAccountEmail === accounts[id] && env.REGISTRATION_EMAIL_MODE === 'staging'
      && env.REGISTRATION_EMAIL_ACTIVATED_AT === descriptor.cutoff
      && env.REGISTRATION_EMAIL_ALLOWED_RECIPIENT === descriptor.allowedRecipient, 'FUNCTION_POLICY_CONFIG');
    const wantedSecrets = id === 'deliverEmailTask' ? SECRET_NAMES : id === 'createEventRegistration' ? ['EMAIL_TOKEN_KEYRING'] : [];
    need(equal(config.secretEnvironmentVariables.map(s => s.secret).sort(),[...wantedSecrets].sort()), 'FUNCTION_POLICY_SECRET');
    for (const secret of config.secretEnvironmentVariables) need(secret.version === descriptor.secretVersions[secret.secret], 'FUNCTION_POLICY_SECRET');
    if (id === 'deliverEmailTask') {
      need(config.timeoutSeconds === 60 && env.EMAIL_PUBLIC_ORIGIN === descriptor.publicOrigin
        && env.GMAIL_SENDER_EMAIL === descriptor.senderEmail && desired.body.labels['deployment-taskqueue'] === 'true', 'FUNCTION_POLICY_CONFIG');
    }
    if (id === 'dispatchRegistrationEmail') {
      const expected = {eventType:'google.cloud.firestore.document.v1.created',retryPolicy:'RETRY_POLICY_RETRY',
        serviceAccountEmail:accounts[id],triggerRegion:descriptor.triggerRegion,eventFilters:[
          {attribute:'database',value:'(default)'},{attribute:'namespace',value:'(default)'},
          {attribute:'document',value:'events/{eventId}/emailIntents/{intentId}',operator:'match-path-pattern'}]};
      need(equal(desired.body.eventTrigger,expected), 'FUNCTION_POLICY_TRIGGER');
    } else need(desired.body.eventTrigger === undefined, 'FUNCTION_POLICY_TRIGGER');
    if (index >= 2) need(desired.body.labels['deployment-callable'] === 'true', 'FUNCTION_POLICY_CONFIG');
    desired.body.buildConfig.source = {storageSource:sourceBinding.storageSource};
  }
  let index = 0, phase = 'before-read', operation = null, polls = 0, lastPoll = 0, stopped = false, lastNow = now, beforeObserved = 0, acceptedBuild = null;
  const usedOperations = new Set();
  function guarded(action, at) {
    try {
      need(!stopped, 'FUNCTION_POLICY_STOPPED');
      need(Number.isFinite(at) && at >= lastNow && at >= issued && at < expires, 'FUNCTION_POLICY_EXPIRED');
      lastNow = at; return action();
    } catch (error) { stopped = true; throw error; }
  }
  guarded(() => {},now);
  return Object.freeze({
    authorize(request, at = Date.now()) {
      return guarded(() => {
        keys(request,['method','url','body','redirect']); need(request.redirect === 'error' && index < 5, 'FUNCTION_POLICY_REQUEST');
        const id = FUNCTION_ORDER[index], target = targets[index];
        if (request.method === 'GET' && request.url === ORIGIN + resource(id) && request.body === null) {
          need(['before-read','readback'].includes(phase), 'FUNCTION_POLICY_PHASE');
          const kind = phase; phase += '-pending'; return {kind,id};
        }
        if (request.method === 'GET' && operation !== null && request.url === ORIGIN + operation && request.body === null) {
          need(phase === 'poll' && polls < 120 && at - lastPoll >= 5000, 'FUNCTION_POLICY_PHASE');
          polls++; lastPoll = at; phase = 'poll-pending'; return {kind:'operation-read',id};
        }
        const targetUrl = index < 2 ? ORIGIN + PREFIX + '/functions?functionId=' + id
          : ORIGIN + resource(id) + '?updateMask=' + target.updateMask.join(',');
        need(phase === 'write' && at - beforeObserved <= 5 * 60_000 && request.method === target.method && request.url === targetUrl
          && equal(request.body,target.body), 'FUNCTION_POLICY_REQUEST');
        phase = 'write-pending'; return {kind:index < 2 ? 'function-create' : 'function-update',id};
      },at);
    },
    acceptBefore(snapshot, at = Date.now()) {
      return guarded(() => {
        need(phase === 'before-read-pending', 'FUNCTION_POLICY_PHASE');
        keys(snapshot,['id','exists','state','observedAt','sourceRevision','body']);
        const observed = utc(snapshot.observedAt), expected = {...before[index],observedAt:snapshot.observedAt};
        need(observed <= at && observed >= utc(before[index].observedAt) && at - observed <= 5 * 60_000 && equal(snapshot,expected), 'FUNCTION_POLICY_DRIFT');
        beforeObserved = observed; phase = 'write';
      },at);
    },
    acceptOperation(snapshot, at = Date.now()) {
      return guarded(() => {
        need(['write-pending','poll-pending'].includes(phase), 'FUNCTION_POLICY_PHASE');
        keys(snapshot,['name','target','done','failed','build']);
        need(typeof snapshot.name === 'string' && snapshot.name.startsWith(PREFIX + '/operations/')
          && /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/u.test(snapshot.name.slice((PREFIX + '/operations/').length))
          && snapshot.target === resource(FUNCTION_ORDER[index]) && typeof snapshot.done === 'boolean'
          && snapshot.failed === false && (operation === null || operation === snapshot.name), 'FUNCTION_POLICY_OPERATION');
        need(operation !== null || !usedOperations.has(snapshot.name), 'FUNCTION_POLICY_OPERATION');
        if (snapshot.done) { buildPointer(snapshot.build); acceptedBuild = snapshot.build; }
        else need(snapshot.build === null, 'FUNCTION_POLICY_BUILD');
        usedOperations.add(snapshot.name);
        operation = snapshot.name; lastPoll = at; phase = snapshot.done ? 'readback' : 'poll';
      },at);
    },
    acceptReadback(snapshot, at = Date.now()) {
      return guarded(() => {
        need(phase === 'readback-pending', 'FUNCTION_POLICY_PHASE');
        keys(snapshot,['id','state','body','service','build','sourceProvenance']);
        const id = FUNCTION_ORDER[index]; bodyShape(snapshot.body,id);
        need(snapshot.body.buildConfig.source !== undefined, 'FUNCTION_POLICY_SOURCE');
        keys(snapshot.sourceProvenance,['resolvedStorageSource']);
        need(snapshot.build === acceptedBuild && equal(snapshot.sourceProvenance.resolvedStorageSource,snapshot.body.buildConfig.source.storageSource), 'FUNCTION_POLICY_SOURCE');
        // GCF copies uploaded code to its managed per-function source object.
        // Exact request/upload hash + target LRO + matching returned build and
        // source/provenance form the evidence chain; this is NOT a remote rehash.
        const actual = JSON.parse(canonical(snapshot.body)), wanted = JSON.parse(canonical(targets[index].body));
        delete actual.buildConfig.source; delete wanted.buildConfig.source;
        need(index < 2 || (snapshot.build !== before[index].sourceRevision
          && snapshot.body.buildConfig.source.storageSource.generation !== before[index].body.buildConfig.source.storageSource.generation), 'FUNCTION_POLICY_SOURCE');
        need(snapshot.id === id && snapshot.state === 'ACTIVE' && equal(actual,wanted)
          && snapshot.service === PREFIX + '/services/' + FUNCTION_ORDER[index].toLowerCase(), 'FUNCTION_POLICY_READBACK');
        index++; phase = index === 5 ? 'complete' : 'before-read'; operation = null; polls = 0; acceptedBuild = null;
      },at);
    },
    status(at = Date.now()) { return guarded(() => ({mode:'FIVE_FUNCTION_REQUEST_POLICY_ONLY',complete:index === 5,
      completedTargets:index,phase,nextTarget:FUNCTION_ORDER[index] ?? null}),at); }
  });
}
