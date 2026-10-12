import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {request,ok,project,region,require,digest} from './cloud.mjs';
const sha=process.env.EVENT_RELEASE_SHA;assert.match(sha??'',/^[a-f0-9]{40}$/);
const newNames=['deleteEvent','restoreEvent','trashEvent'];
const contracts={deleteEvent:'Current verified Auth, recent sign-in, event.delete, current scoped membership, trash state, exact title and revision; each batch rechecks current authority.',restoreEvent:'Current verified Auth, event.manage, scoped current membership, revision and allowed state; never revives capabilities.',trashEvent:'Current verified Auth, event.manage, scoped current membership and revision; no active sessions; revokes capabilities.'};
const dir='.local-data/event-management';
const mode=process.argv[2]??'baseline';
const policyUrl=service=>`https://run.googleapis.com/v2/${service}:getIamPolicy?options.requestedPolicyVersion=3`;
function normalized(p){const copy=structuredClone(p);delete copy.etag;copy.version??=1;copy.bindings=(copy.bindings??[]).map(b=>({...b,members:[...b.members].sort()})).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));return copy;}
const hasGrant=p=>(p.bindings??[]).some(b=>b.role==='roles/run.invoker'&&!b.condition&&b.members.includes('allUsers'));
const deferred=(await readFile(`${dir}/deferred-invokers.jsonl`,'utf8')).trim().split(/\r?\n/).map(JSON.parse);
assert.equal(deferred.length,3);assert.deepEqual(deferred.map(d=>d.functionName).sort(),[...newNames].sort());assert.equal(new Set(deferred.map(d=>d.service)).size,3);
function exactTarget(t){
 assert(newNames.includes(t.functionName),'Function is outside the approved three');
 const original=deferred.find(d=>d.functionName===t.functionName);
 assert(original&&original.project===project&&original.region===region);
 assert.equal(t.service,original.service,'IAM resource differs from authoritative deferred mapping');
 assert.equal(t.service,`projects/${project}/locations/${region}/services/${t.functionName.toLowerCase()}`);
 assert(t.service.startsWith(`projects/${project}/locations/${region}/services/`)&&t.service.split('/').length===6);
}
function exactBaseline(baseline){
 assert.equal(baseline.sha,sha);assert.equal(baseline.project,project);
 assert.equal(baseline.targets.length,3);assert.deepEqual(baseline.targets.map(t=>t.functionName).sort(),[...newNames].sort());
 assert.equal(new Set(baseline.targets.map(t=>t.service)).size,3);
 for(const t of baseline.targets){
  exactTarget(t);assert.equal(t.sha,sha);assert.equal(t.project,project);assert.equal(t.region,region);
  assert.equal(t.function.name,`projects/${project}/locations/${region}/functions/${t.functionName}`);
  assert.equal(t.function.serviceConfig.service,t.service);assert.equal(t.function.buildConfig.entryPoint,t.functionName);
  assert.equal(t.run.name,t.service);assert(t.run.uid&&t.run.invokerIamDisabled!==true);
  assert(t.before?.etag,'Baseline CAS etag required');assert.equal(digest(t.before),t.beforeDigest,'Baseline policy integrity mismatch');
 }
}
if(mode==='baseline'){
 const targets=[];
 for(const d of deferred){
  assert.equal(d.project,project);assert.equal(d.region,region);assert(d.service.startsWith(`projects/${project}/locations/${region}/services/`));
  const f=ok(await request(`https://cloudfunctions.googleapis.com/v2/projects/${project}/locations/${region}/functions/${d.functionName}?fields=name,state,updateTime,buildConfig(runtime,entryPoint,build,sourceProvenance),serviceConfig(service,uri),labels`),'Authoritative Function mapping');
  assert.equal(f.state,'ACTIVE');assert.equal(f.serviceConfig.service,d.service);assert.equal(f.buildConfig.entryPoint,d.functionName);
  const service=ok(await request(`https://run.googleapis.com/v2/${d.service}?fields=name,uid,generation,invokerIamDisabled,ingress,uri,terminalCondition,latestReadyRevision`),'Exact Cloud Run service');
  assert(service.uid&&service.name===d.service&&service.invokerIamDisabled!==true);
  const policy=ok(await request(policyUrl(d.service)),'Full IAM baseline');assert(policy.etag,'CAS etag required');
  const r=await fetch(`https://${region}-${project}.cloudfunctions.net/${d.functionName}`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{"data":{}}'});
  const contentType=r.headers.get('content-type')??'';await r.text();
  targets.push({...d,sha,authorization:contracts[d.functionName],function:f,run:service,before:policy,beforeDigest:digest(policy),alreadyGranted:hasGrant(policy),httpBefore:{status:r.status,contentType,classification:!contentType.includes('json')&&r.status===403?'Cloud Run IAM denial; NOT application authorization evidence':'Requires application QA classification'}});
 }
 await writeFile(`${dir}/iam-baseline-three.json`,JSON.stringify({sha,project,createdAt:new Date().toISOString(),targets},null,2));
 console.log(JSON.stringify({baseline:'PASS',targets:targets.map(t=>({functionName:t.functionName,service:t.service,alreadyGranted:t.alreadyGranted,httpBefore:t.httpBefore}))}));
}else if(mode==='apply'){
 const baseline=JSON.parse(await readFile(`${dir}/iam-baseline-three.json`,'utf8'));exactBaseline(baseline);
 const result={sha,project,startedAt:new Date().toISOString(),changes:[]};
 await writeFile(`${dir}/iam-changes.json`,JSON.stringify(result,null,2),{flag:'wx'});
 for(const t of baseline.targets){
  exactTarget(t);
  const service=ok(await request(`https://run.googleapis.com/v2/${t.service}?fields=name,uid,invokerIamDisabled`),'Fresh exact Run identity');
  assert.equal(service.name,t.service);assert.equal(service.uid,t.run.uid,'Service was recreated since baseline');assert(service.invokerIamDisabled!==true);
  const current=ok(await request(policyUrl(t.service)),'Fresh prewrite IAM');assert.equal(digest(current),t.beforeDigest,'Policy changed since baseline; stop CAS');
  const record={functionName:t.functionName,service:t.service,serviceUid:t.run.uid,before:current,added:false,writeAttempted:false};result.changes.push(record);
  if(!hasGrant(current)){
   const policy=structuredClone(current);policy.bindings??=[];let binding=policy.bindings.find(b=>b.role==='roles/run.invoker'&&!b.condition);
   if(binding)binding.members.push('allUsers');else policy.bindings.push({role:'roles/run.invoker',members:['allUsers']});
   assert(policy.etag);record.writeAttempted=true;record.expectedPolicy=policy;
   await writeFile(`${dir}/iam-changes.json`,JSON.stringify(result,null,2));
   const token=await require('firebase-tools/lib/apiv2').getAccessToken();
   let response;
   try{
    response=await fetch(`https://run.googleapis.com/v2/${t.service}:setIamPolicy`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({policy,updateMask:'bindings,etag'})});
   }catch{
    record.outcome='uncertain-transport';await writeFile(`${dir}/iam-changes.json`,JSON.stringify(result,null,2));
    throw Error('IAM write outcome is uncertain; reconcile recorded attempt before rollback or retry');
   }
   record.writeStatus=response.status;
   // Persist successful application before response parsing or read-back can fail.
   record.added=response.status>=200&&response.status<300;
   record.outcome=record.added?'applied-awaiting-readback':response.status>=500?'uncertain-http':'rejected';
   await writeFile(`${dir}/iam-changes.json`,JSON.stringify(result,null,2));
   await response.body?.cancel().catch(()=>{});
   if(!record.added)throw Error(`Exact approved IAM merge returned HTTP ${response.status}; inspect recorded outcome`);
  }
  record.after=ok(await request(policyUrl(t.service)),'IAM read-back');
  assert(hasGrant(record.after));assert.deepEqual(normalized(record.after),normalized(record.expectedPolicy??current));
  record.runAfter=ok(await request(`https://run.googleapis.com/v2/${t.service}?fields=name,uid,invokerIamDisabled`),'Post-write invoker check');
  assert.equal(record.runAfter.name,t.service);assert.equal(record.runAfter.uid,t.run.uid);assert(record.runAfter.invokerIamDisabled!==true);
  record.verified=true;record.outcome=record.added?'applied-verified':'already-present';record.verifiedAt=new Date().toISOString();await writeFile(`${dir}/iam-changes.json`,JSON.stringify(result,null,2));
  console.log(JSON.stringify({functionName:t.functionName,service:t.service,added:record.added,readBack:'PASS'}));
 }
 result.completedAt=new Date().toISOString();await writeFile(`${dir}/iam-changes.json`,JSON.stringify(result,null,2));
}else if(mode==='rollback'){
 const result=JSON.parse(await readFile(`${dir}/iam-changes.json`,'utf8'));assert.equal(result.sha,sha);assert.equal(result.project,project);
 assert(result.changes.length<=3);assert.equal(new Set(result.changes.map(c=>c.functionName)).size,result.changes.length);
 for(const change of result.changes)exactTarget(change);
 const unresolved=result.changes.filter(c=>c.writeAttempted&&!c.added&&(!c.writeStatus||c.writeStatus>=500||(c.writeStatus>=200&&c.writeStatus<300)))
  .map(c=>({functionName:c.functionName,service:c.service,outcome:c.outcome??'uncertain-recorded-attempt'}));
 if(unresolved.length){
  await writeFile(`${dir}/iam-rollback.json`,JSON.stringify({sha,project,status:'BLOCKED_UNCERTAIN_WRITE',rollback:[],unresolved},null,2));
  throw Error('Uncertain IAM attempts require reconciliation; no grant was automatically removed');
 }
 const rollback=[];
 for(const change of result.changes){
  if(!change.added)continue;
  exactTarget(change);
  assert(!hasGrant(change.before));
  const service=ok(await request(`https://run.googleapis.com/v2/${change.service}?fields=name,uid`),'Rollback exact Run identity');
  assert(change.serviceUid&&service.name===change.service&&service.uid===change.serviceUid,'Rollback cannot change a recreated service');
  const before=ok(await request(policyUrl(change.service)),'Rollback current policy');const policy=structuredClone(before);
  if(hasGrant(policy)){
   policy.bindings=policy.bindings.map(b=>b.role==='roles/run.invoker'&&!b.condition?{...b,members:b.members.filter(m=>m!=='allUsers')}:b).filter(b=>b.members.length);
   assert(policy.etag);const token=await require('firebase-tools/lib/apiv2').getAccessToken();
   const r=await fetch(`https://run.googleapis.com/v2/${change.service}:setIamPolicy`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({policy,updateMask:'bindings,etag'})});ok({status:r.status,data:await r.json()},'Remove only run-added grant');
  }
  const after=ok(await request(policyUrl(change.service)),'Rollback read-back');assert.deepEqual(normalized(after),normalized(policy));rollback.push({functionName:change.functionName,service:change.service,before,after});
  await writeFile(`${dir}/iam-rollback.json`,JSON.stringify({sha,project,rollback},null,2));
 }
 console.log(JSON.stringify({rollback:rollback.length,priorGrantsDeleted:0}));
}else throw Error('Unknown IAM phase');
