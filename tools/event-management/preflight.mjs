import assert from 'node:assert/strict';
import {writeFileSync,readFileSync} from 'node:fs';
import {request,ok,project,number,region,digest} from './cloud.mjs';
const manifest=JSON.parse(readFileSync('tools/event-management/deployment-manifest.json','utf8'));
const apis=['cloudfunctions','cloudbuild','artifactregistry','run','eventarc','pubsub','storage','firestore','firebaserules','firebasehosting','identitytoolkit'].map(s=>s+'.googleapis.com');
const services=await Promise.all(apis.map(api=>request(`https://serviceusage.googleapis.com/v1/projects/${number}/services/${api}?fields=name,state`).then(r=>ok(r,'Required API state'))));
assert(services.every(s=>s.state==='ENABLED'),'Do not enable APIs; prerequisite is not ready');
const inventory=ok(await request(`https://cloudfunctions.googleapis.com/v2/projects/${project}/locations/${region}/functions`),'Function inventory');assert(!inventory.nextPageToken);
const names=inventory.functions.map(f=>f.name.split('/').at(-1));
assert.equal(names.length,68);assert.deepEqual(manifest.functions.filter(n=>!names.includes(n)).sort(),[...manifest.newCallableFunctions].sort());
const policies=[];
for(const f of inventory.functions) {const service=f.serviceConfig.service;const policy=ok(await request(`https://run.googleapis.com/v2/${service}:getIamPolicy?options.requestedPolicyVersion=3`),'Existing service IAM baseline');policies.push({service,hash:digest(policy),policy});}
const projectIam=ok(await request(`https://cloudresourcemanager.googleapis.com/v1/projects/${project}:getIamPolicy`,{}),'Project IAM baseline');
const newServices=[];for(const service of manifest.newInvokerBinding.services) {const r=await request(`https://run.googleapis.com/v2/projects/${project}/locations/${region}/services/${service}`);assert.equal(r.status,404);newServices.push({service,status:'absent'});}
const result={project,at:new Date().toISOString(),services,functions:inventory.functions,policies,projectIam,newServices};
writeFileSync('.local-data/event-management/preflight.json',JSON.stringify(result,null,2));console.log(JSON.stringify({project,functionCount:names.length,newServices,enabledApis:services.length,existingIamPolicies:policies.length}));
