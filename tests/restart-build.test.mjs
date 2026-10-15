import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { validateInputs, targetedEntry, runtimeClosure, artifactPackage, assertArtifactPath, restartViteConfig, assertStagingBanner } from '../tools/staging/restart-build-core.mjs';
import { STAGING_PROJECT, STAGING_APP } from '../tools/staging/guard.mjs';

const json = relative => JSON.parse(readFileSync(new URL(relative, import.meta.url), 'utf8'));
const manifest = json('../tools/staging/restart-release-manifest.json');
const source = readFileSync(new URL('../functions/src/index.ts', import.meta.url), 'utf8');
const sha = 'a'.repeat(40);
const valid = () => ({ sha, head: sha, branch: 'codex/restart-integration', status: '', node: '22.18.0',
  sdk: { projectId: STAGING_PROJECT, apiKey: 'synthetic-public-sdk-key', appId: STAGING_APP, authDomain: `${STAGING_PROJECT}.firebaseapp.com`, messagingSenderId: '177615774316', storageBucket: `${STAGING_PROJECT}.firebasestorage.app` },
  bucket: { projectId: STAGING_PROJECT, name: `${STAGING_PROJECT}.firebasestorage.app`, location: 'EUROPE-WEST1', verified: true, verifiedAt: '2026-10-12T12:00:00Z', evidence: 'Synthetic unit evidence only' } });

test('explicit SHA, clean source, Node22 and verified allowlisted inputs fail closed', () => {
  assert.equal(validateInputs(valid()).VITE_ENABLE_TEAM_EMAIL, 'false');
  for (const mutate of [v => { v.sha = 'abc'; }, v => { v.head = 'b'.repeat(40); }, v => { v.branch = 'main'; },
    v => { v.status = '?? stray-file'; }, v => { v.status = ' M tracked-file'; }, v => { v.node = '24.0.0'; },
    v => { v.sdk.projectId = 'production'; }, v => { v.sdk.private_key = 'secret'; },
    v => { v.bucket.verified = false; }, v => { v.bucket.name = 'other-bucket'; },
    v => { v.bucket.evidence = ''; }, v => { v.bucket.verifiedAt = 'unknown'; }]) {
    const input = valid(); mutate(input); assert.throws(() => validateInputs(input));
  }
});

test('targeted entry contains exactly all 70 exports, excludes health and email workers', () => {
  const entry = targetedEntry(source, manifest.functions);
  assert(!entry.includes('health') && !entry.includes('email/'));
  assert.equal(entry.match(/\bcreateQuizRound\b/gu).length, 1);
  assert.throws(() => targetedEntry(source.replace('updateAccessMembership,', ''), manifest.functions));
  assert.throws(() => targetedEntry(source + "\nexport { createQuiz } from './editor/callables.js';", manifest.functions));
  assert.throws(() => targetedEntry(source, [...manifest.functions.slice(1), manifest.functions[1]]));
});

test('runtime closure includes helpers once and rejects escaping/dev/worker imports', () => {
  const sources = { 'events/callables.js': "import { guard } from '../access/guard.js';", 'access/guard.js': "import 'firebase-admin';" };
  const files = runtimeClosure("export { createEvent } from './events/callables.js';", name => sources[name]);
  assert.deepEqual([...files.keys()], ['index.js', 'events/callables.js', 'access/guard.js']);
  for (const bad of ['../outside.js', './dev/seed.js', './email/worker.js', './email/team-callables.js', './index.js']) {
    assert.throws(() => runtimeClosure(`import '${bad}';`, () => ''), bad);
  }
  assert.throws(() => runtimeClosure('const module = import(variable);', () => ''));
  assert.throws(() => runtimeClosure("import 'unlisted-runtime';", () => '', ['firebase-admin']));
  assert.doesNotThrow(() => runtimeClosure("import 'node:fs'; import 'firebase-admin/app';", () => '', ['firebase-admin']));
});

test('runtime package matches inventory and locked vendored domain dependency', () => {
  const pkg = json('../functions/package.json'), lock = json('../tools/staging/functions-package-lock.json');
  const result = artifactPackage(pkg, lock, manifest);
  assert.equal(result.dependencies['@filmovy-kviz/quiz-domain'], 'file:vendor/quiz-domain');
  assert.equal(result.scripts, undefined);
  const drift = structuredClone(lock); drift.packages[''].dependencies['firebase-admin'] = '^99.0.0';
  assert.throws(() => artifactPackage(pkg, drift, manifest));
  const newDependency = structuredClone(pkg); newDependency.dependencies.uninventoried = '1.0.0';
  assert.throws(() => artifactPackage(newDependency, lock, manifest));
});

test('artifact boundary accepts deployment files, rejects secrets, fixtures and source maps', () => {
  for (const name of ['hosting/assets/main.js', 'functions/lib/access/callables.js', 'functions/vendor/quiz-domain/lib/index.d.ts', 'functions/package-lock.json', 'firebase.restart.json', 'storage.rules', 'receipt.json']) assertArtifactPath(name);
  for (const name of ['functions/lib/dev/seed.js', 'functions/.env', 'hosting/assets/key.pem', 'functions/lib/test/fixture.js', '../outside', 'functions/node_modules/a.js', 'functions/lib/access/a.js.map', 'random.json', 'hosting/service-account.json']) assert.throws(() => assertArtifactPath(name), name);
});

test('generated Vite config resolves domain exactly to fresh build, bypassing stale workspace lib', () => {
  const root = path.resolve('synthetic-repository'), fresh = path.join(root, '.local-data/restart-build', sha, 'domain');
  const generated = restartViteConfig(root, fresh, path.join(root, '.local-data/restart-release', sha, 'hosting'));
  const expression = generated.slice(generated.indexOf('export default ') + 'export default '.length);
  const config = vm.runInNewContext(expression, { defineConfig: value => value, react: () => 'synthetic-plugin' });
  assert.equal(config.envDir, false);
  const alias = config.resolve.alias[0];
  assert(alias.find.test('@filmovy-kviz/quiz-domain'));
  assert(!alias.find.test('@filmovy-kviz/quiz-domain/access'));
  assert(!alias.find.test('prefix@filmovy-kviz/quiz-domain'));
  assert.equal('@filmovy-kviz/quiz-domain'.replace(alias.find, alias.replacement), path.join(fresh, 'index.js'));
  assert(!alias.replacement.includes(path.join('packages', 'quiz-domain', 'lib')));
  assert(!alias.replacement.includes('node_modules'));
});

test('staging banner guard requires the current rendered JS label, not stale text or CSS', () => {
  const banner = 'D.jsx("span",{className:"admin-environment-label",children:"V2 staging"})';
  const file = text => [{ name: 'assets/index-synthetic.js', text }];
  assert.doesNotThrow(() => assertStagingBanner(file(banner)));
  assert.doesNotThrow(() => assertStagingBanner(file(banner.replace('children:', 'title:"Samostatné prostředí V2",children:'))));
  for (const text of ['STAGING', banner.replace('V2 staging', 'Production'), banner.replace('V2 staging', 'Testovací verze'), banner.replace('admin-environment-label', 'ordinary-label'), 'const label="V2 staging"; const css="admin-environment-label";']) {
    assert.throws(() => assertStagingBanner(file(text)));
  }
  assert.throws(() => assertStagingBanner([{ name: 'assets/main.css', text: banner }]));
  assert.throws(() => assertStagingBanner([]));
});
