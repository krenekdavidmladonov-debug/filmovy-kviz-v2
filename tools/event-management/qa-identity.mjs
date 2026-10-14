// Explicit staging-only synthetic QA. No existing identity is read, reset or reused.
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { request, ok, project, digest } from './cloud.mjs';
import { stagingWebConfig } from '../staging/cloud.mjs';
import { permissions } from '../../packages/quiz-domain/lib/access.js';
const encode = v => v === null ? { nullValue: null } : v instanceof Date ? { timestampValue: v.toISOString() } : typeof v === 'boolean' ? { booleanValue: v } : typeof v === 'number' ? { integerValue: String(v) } : typeof v === 'string' ? { stringValue: v } : Array.isArray(v) ? { arrayValue: { values: v.map(encode) } } : { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k,x])=>[k,encode(x)])) } };
const decode = v => 'nullValue' in v ? null : 'timestampValue' in v ? { toDate: () => new Date(v.timestampValue), toMillis: () => Date.parse(v.timestampValue) } : 'stringValue' in v ? v.stringValue : 'booleanValue' in v ? v.booleanValue : 'integerValue' in v ? Number(v.integerValue) : 'doubleValue' in v ? v.doubleValue : 'arrayValue' in v ? (v.arrayValue.values ?? []).map(decode) : Object.fromEntries(Object.entries(v.mapValue?.fields ?? {}).map(([k,x])=>[k,decode(x)]));
const fields = v => encode(v).mapValue.fields;
export async function cloudQaIdentity() {
  assert.equal(process.env.EVENT_QA_STAGING, project, 'Explicit fixed staging QA required');
  assert(!process.env.FIRESTORE_EMULATOR_HOST);
  const config = await stagingWebConfig(); assert.equal(config.projectId, project);
  const uid = 'event-qa-' + randomUUID(), email = uid + '@example.test', password = randomBytes(30).toString('base64url') + '!aA9';
  const base = `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents`;
  const auth = `https://identitytoolkit.googleapis.com/v1/projects/${project}`;
  const owned = new Set(['memberships/' + uid]), eventIds = new Set(), quizIds = new Set();
  const report = { uid, project, createdAt: new Date().toISOString(), owned: [], cleanup: [], objects: [], errors: [] };
  const output = '.local-data/event-management/online/' + uid + '.json'; mkdirSync('.local-data/event-management/online', { recursive: true });
  const save = () => { report.owned = [...owned]; writeFileSync(output, JSON.stringify(report, null, 2)); };
  let token, accountCreated = false;
  async function rawCall(name, data, bearer = token) {
    assert(/^[a-zA-Z]+$/.test(name));
    const r = await fetch(`https://europe-west1-${project}.cloudfunctions.net/${name}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(bearer ? { Authorization: 'Bearer ' + bearer } : {}) }, body: JSON.stringify({ data }), signal: AbortSignal.timeout(310000) });
    return { status: r.status, data: await r.json() };
  }
  async function call(name, data) { const r = await rawCall(name, data); if (r.data.error) { const e = new Error(name + ': ' + r.data.error.status); e.code = 'functions/' + r.data.error.status.toLowerCase().replaceAll('_','-'); throw e; } return r.data.result ?? r.data.data; }
  function validPath(p, document = true) { assert(typeof p === 'string'); const segments=p.split('/'); assert(segments.length >= 2 && segments.every(x=>/^[A-Za-z0-9_-]{1,1500}$/.test(x)) && segments.length % 2 === (document ? 0 : 1), 'Invalid exact QA path'); assert.equal(new URL(base+'/'+p).pathname.split('/documents/')[1],p); }
  async function readRaw(p) { validPath(p); const r = await request(base + '/' + p); if (r.status === 404) return null; return ok(r, 'QA read'); }
  async function prove(p) {
    validPath(p, p.split('/').length % 2 === 0);
    const root = p.split('/').slice(0,2).join('/'); if (owned.has(root)) return;
    const [kind,id] = root.split('/');
    if (['eventDeletions','eventTombstones','publicEvents'].includes(kind) && eventIds.has(id)) { owned.add(root); return; }
    const doc = await readRaw(root), d = doc?.fields ? decode({mapValue:{fields:doc.fields}}) : null;
    if (['events','quizzes'].includes(kind)) {
      assert(d?.createdBy === uid && String(d.title).startsWith('QA '), 'Only UI-created content of this exact QA user is allowed');
      (kind==='events'?eventIds:quizIds).add(id);
    } else if (['sessions','quizSnapshots'].includes(kind)) assert(eventIds.has(d?.eventId), 'Derived resource must belong to an exact owned event');
    else if (kind === 'publicSessions') { await prove('sessions/' + id); }
    else throw Error('Not an owned QA resource');
    owned.add(root); save();
  }
  async function children(p) { validPath(p); const r=ok(await request(base+'/'+p+':listCollectionIds', {pageSize:1000}), 'QA children'); assert(!r.nextPageToken); return (r.collectionIds??[]).map(id=>({id,path:p+'/'+id})); }
  async function list(p) { validPath(p, false);
    await prove(p); const rows=[]; let next;
    do { const r=ok(await request(base+'/'+p+'?pageSize=1000&showMissing=true'+(next?'&pageToken='+encodeURIComponent(next):'')), 'QA list'); rows.push(...(r.documents??[])); next=r.nextPageToken; } while(next);
    return { size: rows.filter(d=>d.createTime).length, docs: rows.map(d=>snap(d.name.split('/documents/')[1],d)) };
  }
  function snap(p,raw) { const d=raw?.createTime?decode({mapValue:{fields:raw.fields??{}}}):undefined; return { id:p.split('/').at(-1), ref:doc(p), exists:!!raw?.createTime, data:()=>d, get:key=>key.split('.').reduce((a,k)=>a?.[k],d) }; }
  function doc(p) { validPath(p); return {path:p, id:p.split('/').at(-1), get:async()=>{await prove(p);return snap(p,await readRaw(p));}, listCollections:async()=>{await prove(p);return children(p);}, collection:name=>({get:()=>list(p+'/'+name)}), delete:async()=>{await prove(p);ok(await request(base+'/'+p,undefined,'DELETE'),'QA exact delete');} }; }
  async function remove(p) {
    await prove(p);
    for (const c of await children(p)) for (const d of (await list(c.path)).docs) await remove(d.ref.path);
    const raw=await readRaw(p); if(raw?.createTime) ok(await request(base+'/'+p+'?currentDocument.updateTime='+encodeURIComponent(raw.updateTime),undefined,'DELETE'),'QA cleanup');
  }
  async function patchMembership(data) {
    assert(Object.keys(data).every(k=>['permissions','events','quizzes','status'].includes(k)), 'Only scoped QA grant changes');
    if(data.permissions) assert(data.permissions.every(p=>permissions.includes(p)&&p!=='users.manage'));
    if(data.status) assert(['active','suspended'].includes(data.status));
    for(const key of ['events','quizzes']) if(data[key]) { const scope=data[key]; assert(['none','own','selected'].includes(scope.mode)&&Array.isArray(scope.ids)); assert(scope.ids.every(id=>(key==='events'?eventIds:quizIds).has(id))); if(scope.mode!=='selected') assert.equal(scope.ids.length,0); }
    const p='memberships/'+uid,current=decode({mapValue:{fields:(await readRaw(p)).fields}});assert.equal(current.uid,uid);assert.equal(current.role,'manager');
    const patch={...data,version:current.version+1},mask=Object.keys(patch).map(k=>'updateMask.fieldPaths='+encodeURIComponent(k)).join('&');ok(await request(base+'/'+p+'?currentDocument.exists=true&'+mask,{fields:fields(patch)},'PATCH'),'QA own membership');
  }
  try {
    assert.equal(ok(await request(auth+'/accounts',{localId:uid,email,password,emailVerified:true,displayName:'QA Event management'}),'Create isolated QA identity').localId,uid); accountCreated = true; save();
    const grant={role:'manager',permissions:permissions.filter(p=>p!=='users.manage'),events:{mode:'own',ids:[]},quizzes:{mode:'own',ids:[]}};
    ok(await request(base+'/memberships/'+uid+'?currentDocument.exists=false',{fields:fields({...grant,uid,email,displayName:'QA Event management',status:'active',version:1,sessionValidAfter:0})},'PATCH'),'Create isolated QA grant');
    const r=await fetch('https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key='+encodeURIComponent(config.apiKey),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password,returnSecureToken:true})}); const login=await r.json();assert(r.ok&&login.localId===uid);token=login.idToken;
  } catch(e) { report.errors.push('setup failed'); if (accountCreated) { await request(base+'/memberships/'+uid,undefined,'DELETE'); await request(auth+'/accounts:delete',{localId:uid}); } save();throw e; }
  async function reauthenticate() { const r=await fetch('https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key='+encodeURIComponent(config.apiKey),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password,returnSecureToken:true})});const login=await r.json();assert(r.ok&&login.localId===uid);token=login.idToken; }
  return { uid,email,password,reauthenticate,origin:`https://${project}.web.app`,call,rawCall,prove,patchMembership,digest,readRaw,
    evidence(label, data) { assert(/^[a-z-]+$/.test(label)); report[label]=data;save(); },
    async deletionFault(eventId, clear = false) {
      assert(eventIds.has(eventId)); const p='events/'+eventId+'/scores/qa-fault/unknown/qa';validPath(p);
      if(clear) ok(await request(base+'/'+p,undefined,'DELETE'),'Clear exact QA deletion fault');
      else ok(await request(base+'/'+p+'?currentDocument.exists=false',{fields:fields({qaRunId:uid})},'PATCH'),'Inject isolated negative-test fault');
    },
    db:{doc,collection:p=>({get:()=>list(p)}),recursiveDelete:ref=>remove(ref.path)},
    async dispose() {
      try {
        for (const collectionId of ['events','quizzes']) {
          const rows=ok(await request(base+':runQuery',{structuredQuery:{from:[{collectionId}],where:{fieldFilter:{field:{fieldPath:'createdBy'},op:'EQUAL',value:{stringValue:uid}}}}}),'Discover exact QA creator roots');
          for(const row of rows) if(row.document) await prove(row.document.name.split('/documents/')[1]);
        }
        // Discover only exact event-owned derivatives before removing roots.
        for(const eventId of eventIds) for(const collectionId of ['sessions','quizSnapshots']) {
          const rows=ok(await request(base+':runQuery',{structuredQuery:{from:[{collectionId}],where:{fieldFilter:{field:{fieldPath:'eventId'},op:'EQUAL',value:{stringValue:eventId}}}}}),'QA derivatives');
          for(const row of rows) if(row.document) owned.add(row.document.name.split('/documents/')[1]);
        }
        for(const quizId of quizIds) {
          const assets=await list('quizzes/'+quizId+'/mediaAssets');
          for(const asset of assets.docs) { const a=asset.data(); assert(a); assert.equal(a.quizId,quizId); assert.equal(a.createdBy,uid); a.path='quiz-assets/'+quizId+'/'+asset.id+'/source'; if(!a.generation) { const meta=await request(`https://storage.googleapis.com/storage/v1/b/${project}.firebasestorage.app/o/${encodeURIComponent(a.path)}`); if(meta.status===404) continue; a.generation=ok(meta,'Exact pending QA upload').generation; assert(a.generation); } const url=`https://storage.googleapis.com/storage/v1/b/${project}.firebasestorage.app/o/${encodeURIComponent(a.path)}?ifGenerationMatch=${encodeURIComponent(a.generation)}`;ok(await request(url,undefined,'DELETE'),'Exact QA media generation cleanup');report.objects.push({path:a.path,generation:a.generation}); }
        }
        for(const root of [...owned].filter(p=>p.startsWith('sessions/'))) owned.add('publicSessions/'+root.split('/')[1]);
        for(const id of eventIds) owned.add('publicEvents/'+id);
        for(const p of [...owned].filter(p=>!p.startsWith('eventDeletions/')&&!p.startsWith('eventTombstones/'))) { await remove(p);report.cleanup.push(p); }
        ok(await request(auth+'/accounts:delete',{localId:uid}),'Exact QA identity cleanup');report.cleanup.push('Auth/'+uid);
      } catch(e) {report.errors.push(String(e.message));throw e;} finally {save();}
    }
  };
}
