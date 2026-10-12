// Read-only staging inventory. Output contains hashes and paths, never document contents or tokens.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { request, ok, project, digest } from './cloud.mjs';
const base = `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents`;
const out = '.local-data/event-management'; mkdirSync(out, { recursive: true });
const documents = [], collections = new Set();
async function walk(parent) {
  let pageToken;
  do {
    const response = ok(await request(parent + ':listCollectionIds', { pageSize: 1000, ...(pageToken ? { pageToken } : {}) }), 'collection ids');
    for (const id of response.collectionIds ?? []) {
      collections.add(id);
      let docToken;
      do {
        const result = ok(await request(parent + '/' + id + '?pageSize=1000&showMissing=true' + (docToken ? '&pageToken=' + encodeURIComponent(docToken) : '')), 'documents');
        for (const doc of result.documents ?? []) {
          if (doc.createTime) documents.push({ path: doc.name.split('/documents/')[1], hash: digest(doc) });
          await walk('https://firestore.googleapis.com/v1/' + doc.name);
        }
        docToken = result.nextPageToken;
      } while (docToken);
    }
    pageToken = response.nextPageToken;
  } while (pageToken);
}
await walk(base);
const storage = ok(await request(`https://storage.googleapis.com/storage/v1/b/${project}.firebasestorage.app/o`), 'storage');
assert(!storage.nextPageToken, 'Storage listing requires pagination before fingerprint is complete.');
const objects = (storage.items ?? []).map(o => ({ name: o.name, generation: o.generation, hash: digest(o) }));
const functions = ok(await request(`https://cloudfunctions.googleapis.com/v2/projects/${project}/locations/europe-west1/functions`), 'functions');
assert(!functions.nextPageToken);
const releases = ok(await request(`https://firebasehosting.googleapis.com/v1beta1/sites/${project}/releases?pageSize=1`), 'hosting');
const release = releases.releases?.[0];
const hostedFiles = ok(await request('https://firebasehosting.googleapis.com/v1beta1/' + release.version.name + '/files?pageSize=1000'), 'hosting files');
assert(!hostedFiles.nextPageToken);
const receipt = { at: new Date().toISOString(), project, documents: documents.sort((a,b)=>a.path.localeCompare(b.path)), collections: [...collections].sort(), objects, functions: functions.functions.map(f => ({ name: f.name, state: f.state, updateTime: f.updateTime, serviceConfig: { service: f.serviceConfig.service, secretEnvironmentVariables: f.serviceConfig.secretEnvironmentVariables ?? [] } })), release: { name: release.name, version: release.version.name, time: release.releaseTime }, hostedFiles: hostedFiles.files };
const stamp = process.argv[2] ?? 'before'; assert(/^[a-z0-9-]+$/.test(stamp));
writeFileSync(out + '/inventory-' + stamp + '.json', JSON.stringify(receipt, null, 2));
console.log(JSON.stringify({ project, documents: documents.length, objects: objects.length, functions: receipt.functions.length, release: receipt.release, counts: Object.fromEntries([...collections].sort().map(id=>[id,documents.filter(d=>d.path.split('/').at(-2)===id).length])) }));
