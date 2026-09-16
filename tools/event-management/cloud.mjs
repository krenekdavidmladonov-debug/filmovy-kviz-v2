import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { stagingClient } from '../staging/cloud.mjs';
export const project = 'filmovy-kviz-v2-staging';
export const number = '177615774316';
export const region = 'europe-west1';

export const require = createRequire(import.meta.url);
await stagingClient('https://firebase.googleapis.com', 'v1beta1');
const hosts = new Set(['firebase.googleapis.com','identitytoolkit.googleapis.com','cloudresourcemanager.googleapis.com','cloudfunctions.googleapis.com','firebasehosting.googleapis.com','firestore.googleapis.com','storage.googleapis.com','run.googleapis.com','serviceusage.googleapis.com','iam.googleapis.com','artifactregistry.googleapis.com','firebaserules.googleapis.com']);
export async function request(url, body, method = body === undefined ? 'GET' : 'POST') {
  const u = new URL(url);
  assert(u.protocol === 'https:' && hosts.has(u.hostname));
  assert(u.pathname.includes(project) || u.pathname.includes(number), 'Fixed staging resource required');
  assert(!u.pathname.includes(':setIamPolicy'), 'Use explicit CAS IAM writer, never generic request');
  assert(!/:(enable|disable|generateServiceIdentity)|\/keys(?:\/|$)/.test(u.pathname));
  if (['iam.googleapis.com','run.googleapis.com','serviceusage.googleapis.com','cloudresourcemanager.googleapis.com','artifactregistry.googleapis.com'].includes(u.hostname)) assert(method === 'GET' || (method === 'POST' && u.hostname === 'cloudresourcemanager.googleapis.com' && u.pathname === `/v1/projects/${project}:getIamPolicy`), 'Infrastructure helper is read only');
  const token = await require('firebase-tools/lib/apiv2').getAccessToken();
  const r = await fetch(u, { method, headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : {'Content-Type':'application/json'}) }, ...(body === undefined ? {} : {body:JSON.stringify(body)}) });
  const data = await r.json().catch(() => ({}));
  return {status:r.status,data};
}
export function ok(r, label) { if(r.status < 200 || r.status >= 300) throw Error(`${label}: HTTP ${r.status} ${r.data?.error?.status ?? ''} ${r.data?.error?.message ?? ''}`); return r.data; }
function canonical(v) { if(Array.isArray(v)) return v.map(canonical); if(v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])); return v; }
export function digest(v) { return createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex'); }
