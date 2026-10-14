'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {AsyncLocalStorage} = require('node:async_hooks');
const {createHash} = require('node:crypto');
const project='filmovy-kviz-v2-staging', number='177615774316', region='europe-west1', sha=process.env.EVENT_RELEASE_SHA;
const dir=path.resolve('.local-data/event-management');
const receipt=JSON.parse(fs.readFileSync(path.join(dir,`release-${sha}/receipt.json`),'utf8'));
const evidence=JSON.parse(fs.readFileSync(path.join(dir,'deployment-evidence-before.json'),'utf8'));
assert.equal(evidence.sha,sha);assert.equal(evidence.ci.conclusion,'success');
assert.match(sha??'',/^[a-f0-9]{40}$/);
const manifest=JSON.parse(fs.readFileSync('tools/event-management/deployment-manifest.json','utf8'));
const names=receipt.functions, additions=manifest.newCallableFunctions;
assert.deepEqual([...names].sort(),[...manifest.functions].sort());
assert.equal(names.length,49);assert.equal(additions.length,3);
assert.equal(require('firebase-tools/package.json').version,'15.28.2');
for(const [file,hash] of Object.entries(receipt.sourceHashes)) assert.equal(createHash('sha256').update(fs.readFileSync(path.join(receipt.source,file))).digest('hex'),hash,file);
const log=(event,details={})=>fs.appendFileSync(path.join(dir,'deployment-guard.jsonl'),JSON.stringify({at:new Date().toISOString(),event,...details})+'\n');
const fail=(why)=>{log('BLOCKED',{reason:why});throw Error(`Event management deployment guard: ${why}`);};
const cli=n=>require(`firebase-tools/lib/${n}`);
const b=cli('deploy/functions/backend');
let verifiedBackend=false,verifiedPlan=false;
function checkBackend(backend){
 const endpoints=b.allEndpoints(backend);
 assert.deepEqual(endpoints.map(e=>e.id).sort(),[...names].sort());
 assert(!backend.requiredRoles?.length && !Object.keys(backend.lifecycleHooks??{}).length);
 for(const e of endpoints){
  assert.equal(e.project,project);assert.equal(e.region,region);assert.equal(e.platform,'gcfv2');
  assert(b.isCallableTriggered(e)||b.isHttpsTriggered(e));
  assert(!e.eventTrigger&&!e.scheduleTrigger&&!e.taskQueueTrigger&&!e.blockingTrigger&&!e.dataConnectGraphqlTrigger&&!e.callableTrigger?.genkitAction);
  assert(!e.secretEnvironmentVariables?.length);
 }
 verifiedBackend=true;log('verified-http-only-backend',{functions:endpoints.map(e=>e.id)});
}
const build=cli('deploy/functions/build'), resolveBackend=build.resolveBackend;
build.resolveBackend=async function(opts,...args){
 const raw=opts.build;
 assert.deepEqual(Object.keys(raw.endpoints).sort(),[...names].sort());
 for(const e of Object.values(raw.endpoints)){
  assert.equal(e.platform,'gcfv2');assert(!e.secretEnvironmentVariables?.length);
  assert((e.callableTrigger||e.httpsTrigger)&&!e.eventTrigger&&!e.taskQueueTrigger&&!e.scheduleTrigger&&!e.blockingTrigger);
 }
 const omitted=raw.params ?? [];
 assert.equal(omitted.length,0,'No secret or configuration declarations allowed');
 const result=await resolveBackend.call(this,opts,...args);
 checkBackend(result.backend);return result;
};
const usage=cli('gcp/serviceusage');
usage.generateServiceIdentity=async function(n,service,prefix){
 assert(verifiedBackend);assert.equal(String(n),number);assert.equal(prefix,'functions');
 assert(['pubsub.googleapis.com','eventarc.googleapis.com'].includes(service));
 log('skipped-unused-service-identity-preparation',{service,reason:'All 49 endpoints verified HTTP/callable only; no event service is needed; no identity claimed or created.'});
 return undefined;
};
const ensure=cli('ensureApiEnabled');
ensure.ensure=async function(p,api,prefix){
 assert([project,number].includes(String(p)));
 const enabled=await ensure.check(p,api,prefix,true);
 if(!enabled)fail(`API is not already enabled: ${api}`);
};
const planner=cli('deploy/functions/release/planner'),createPlan=planner.createDeploymentPlan;
planner.createDeploymentPlan=async function(...args){
 const plan=await createPlan.apply(this,args);
 checkBackend(plan.plannedBackend);
 for(const key of ['rolesToAdd','rolesToRemove'])assert(!plan[key]?.length);
 for(const key of ['serviceAccountToCreate','serviceAccountToDelete','managedServiceAccount'])assert(!plan[key]);
 assert.equal(Object.keys(plan.secretAccessPlan??{}).length,0);
 const sets=Object.values(plan.regionalChangesets), creates=sets.flatMap(s=>s.endpointsToCreate),updates=sets.flatMap(s=>s.endpointsToUpdate);
 assert.equal(sets.flatMap(s=>s.endpointsToDelete).length,0);assert.equal(sets.flatMap(s=>s.endpointsToSkip).length,0);
 assert.deepEqual(creates.map(e=>e.id).sort(),[...additions].sort());assert.equal(updates.length,46);
 assert(updates.every(u=>!u.deleteAndRecreate&&!u.unsafe&&names.includes(u.endpoint.id)&&!additions.includes(u.endpoint.id)));
 const safe={sha,creates:creates.map(e=>e.id),updates:updates.map(u=>u.endpoint.id),deletes:[],iamDeferred:additions,verifiedAt:new Date().toISOString()};
 fs.writeFileSync(path.join(dir,'deployment-plan-verified.json'),JSON.stringify(safe,null,2));verifiedPlan=true;log('verified-plan',safe);return plan;
};
const fab=cli('deploy/functions/release/fabricator').Fabricator;
const originalApply=fab.prototype.applyPlan;
fab.prototype.applyPlan=async function(...args){assert(verifiedPlan);return originalApply.apply(this,args);};
const scope=new AsyncLocalStorage(),create=fab.prototype.createV2Function;
fab.prototype.createV2Function=async function(endpoint,...args){assert(verifiedPlan&&additions.includes(endpoint.id));return scope.run(endpoint,()=>create.call(this,endpoint,...args));};
const run=cli('gcp/run');
run.setInvokerCreate=async function(p,service,invoker){
 const endpoint=scope.getStore();assert(endpoint&&additions.includes(endpoint.id));assert.equal(p,project);assert.deepEqual(invoker,['public']);
 assert(service.startsWith(`projects/${project}/locations/${region}/services/`));assert.equal(service.split('/').length,6);
 const record={functionName:endpoint.id,service,project,region,invoker,source:'Completed Cloud Functions create operation serviceConfig.service',at:new Date().toISOString()};
 fs.appendFileSync(path.join(dir,'deferred-invokers.jsonl'),JSON.stringify(record)+'\n');log('deferred-approved-invoker',record);
};
for(const method of ['setInvokerUpdate','setIamPolicy'])run[method]=()=>fail(`Forbidden run.${method}`);
for(const method of ['deleteV1Function','deleteV2Function'])fab.prototype[method]=()=>fail(`Function deletion forbidden: ${method}`);
const artifact=cli('functions/artifacts');
artifact.setCleanupPolicies=()=>fail('Artifact cleanup policy mutation is outside scope');
const uploadUrls=new Set(),gcf=cli('gcp/cloudfunctionsv2'),generateUpload=gcf.generateUploadUrl;
gcf.generateUploadUrl=async function(...args){
 assert(verifiedBackend);const result=await generateUpload.apply(this,args);
 if(result.uploadUrl){const u=new URL(result.uploadUrl);uploadUrls.add(u.origin+u.pathname);}
 return result;
};
const api=cli('apiv2'),request=api.Client.prototype.request;
api.Client.prototype.request=async function(req){
 const method=(req.method||'GET').toUpperCase();
 const prefix=new URL(this.opts.urlPrefix), url=new URL(req.path||'',prefix.origin+'/');
 const host=prefix.hostname,p=url.pathname;
 if(/:setIamPolicy$|:generateServiceIdentity$|:(enable|disable)$|\/keys(?:\/|$)/.test(p))fail(`Forbidden ${method} ${host}${p}`);
 if(!['GET','HEAD','OPTIONS'].includes(method)){
  const readAction=/:getIamPolicy$|:testIamPermissions$|:testPermissions$/.test(p);
  const oauth=['oauth2.googleapis.com','accounts.google.com'].includes(host)&&method==='POST';
  const functionUpload=host==='cloudfunctions.googleapis.com'&&method==='POST'&&p===`/projects/${project}/locations/${region}/functions:generateUploadUrl`&&verifiedBackend;
  const functionCreate=host==='cloudfunctions.googleapis.com'&&method==='POST'&&p===`/projects/${project}/locations/${region}/functions`&&verifiedPlan&&additions.includes(req.queryParams?.functionId);
  const functionUpdate=host==='cloudfunctions.googleapis.com'&&method==='PATCH'&&p.startsWith(`/projects/${project}/locations/${region}/functions/`)&&verifiedPlan&&names.includes(p.split('/').at(-1));
  const sourceUpload=method==='PUT'&&uploadUrls.has(prefix.origin+p);
  if(!(readAction||oauth||functionUpload||functionCreate||functionUpdate||sourceUpload))fail(`Unapproved write ${method} ${host}${p}`);
  if(!readAction&&!oauth)log('allowed-deployment-write',{method,host,path:p});
 }
 return request.call(this,req);
};
log('guard-loaded',{sha,project,functions:49,newFunctions:3});
