import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, writeFileSync, readdirSync, realpathSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import ts from 'typescript';
import { stagingWebConfig } from '../staging/cloud.mjs';
import { assertStagingEnvironment, STAGING_PROJECT } from '../staging/guard.mjs';
import { assertFrontendFiles } from '../staging/hosting-only.mjs';

// Local artifact preparation only. This program has no deploy or cloud write operation.
const root = fileURLToPath(new URL('../../', import.meta.url));
process.chdir(root);
const sha = process.argv[2]; assert.match(sha ?? '', /^[a-f0-9]{40}$/u);
assert.equal(Number(process.versions.node.split('.')[0]), 22);
const git = args => { const r = spawnSync('git', args, { encoding: 'utf8' }); assert.equal(r.status, 0); return r.stdout.trim(); };
assert.equal(git(['rev-parse', 'HEAD']), sha); assert.equal(git(['status', '--porcelain']), '');
assert.equal(git(['branch', '--show-current']), 'codex/justkviz-event-management');
const manifest = JSON.parse(readFileSync('tools/event-management/deployment-manifest.json', 'utf8'));
assert.equal(manifest.projectId, STAGING_PROJECT); assert.equal(manifest.functions.length, 49);
const destination = path.join(root, '.local-data/event-management/release-' + sha);
assert(!existsSync(destination), 'Use a fresh artifact directory.');
mkdirSync(destination);
const sdk = await stagingWebConfig();
const env = { ...process.env, VITE_APP_ENV: 'staging', VITE_FIREBASE_API_KEY: sdk.apiKey,
  VITE_FIREBASE_AUTH_DOMAIN: sdk.authDomain, VITE_FIREBASE_PROJECT_ID: sdk.projectId,
  VITE_FIREBASE_STORAGE_BUCKET: `${STAGING_PROJECT}.firebasestorage.app`, VITE_FIREBASE_MESSAGING_SENDER_ID: sdk.messagingSenderId,
  VITE_FIREBASE_APP_ID: sdk.appId, VITE_FIREBASE_USE_EMULATORS: 'false', VITE_FIREBASE_ALLOW_NON_DEMO_PROJECT: 'true', VITE_ENABLE_TEAM_EMAIL: 'false' };
assertStagingEnvironment(env);
function run(file, args, cwd = root) { const r = spawnSync(process.execPath, [file, ...args], { cwd, env, stdio: 'inherit' }); assert.equal(r.status, 0, 'Artifact build failed.'); }
run(path.join(root, 'node_modules/typescript/bin/tsc'), ['-p', 'packages/quiz-domain/tsconfig.json']);
run(path.join(root, 'node_modules/typescript/bin/tsc'), ['-p', 'functions/tsconfig.json']);
const hosting = path.join(destination, 'hosting'), source = path.join(destination, 'functions');
run(path.join(root, 'apps/web/node_modules/vite/bin/vite.js'), ['build', '--mode', 'staging', '--outDir', hosting], path.join(root, 'apps/web'));
mkdirSync(source);
cpSync('functions/lib', path.join(source, 'lib'), { recursive: true, filter: name => !name.split(path.sep).includes('dev') });
mkdirSync(path.join(source, 'vendor/quiz-domain'), { recursive: true });
cpSync('packages/quiz-domain/lib', path.join(source, 'vendor/quiz-domain/lib'), { recursive: true });
cpSync('packages/quiz-domain/package.json', path.join(source, 'vendor/quiz-domain/package.json'));
const parsed = ts.createSourceFile('index.ts', readFileSync('functions/src/index.ts', 'utf8'), ts.ScriptTarget.Latest, true), exported = [], lines = [];
for (const statement of parsed.statements) {
  if (!ts.isExportDeclaration(statement) || !statement.moduleSpecifier || !statement.exportClause || !ts.isNamedExports(statement.exportClause)) continue;
  const names = statement.exportClause.elements.map(e => e.name.text).filter(name => manifest.functions.includes(name));
  if (names.length) { lines.push(`export { ${names.join(', ')} } from ${statement.moduleSpecifier.getText(parsed)};`); exported.push(...names); }
}
assert.deepEqual([...exported].sort(), [...manifest.functions].sort());
writeFileSync(path.join(source, 'lib/event-release.js'), lines.join('\n') + '\n');
const pkg = JSON.parse(readFileSync('functions/package.json', 'utf8')); delete pkg.scripts;
pkg.main = 'lib/event-release.js'; pkg.dependencies['@filmovy-kviz/quiz-domain'] = 'file:vendor/quiz-domain';
writeFileSync(path.join(source, 'package.json'), JSON.stringify(pkg, null, 2));
cpSync('tools/staging/functions-package-lock.json', path.join(source, 'package-lock.json'));
run(path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'), ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], source);
function files(directory, prefix = '') {
  assert.equal(realpathSync(directory), directory);
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    assert(!entry.isSymbolicLink(), 'Symlinks cannot be uploaded.');
    if (entry.name === 'node_modules') return [];
    const name = prefix + entry.name, absolute = path.join(directory, entry.name);
    assert(!/^(?:\.env(?:\.|$)|credentials?\.json$|service.account.*\.json$)|\.(?:pem|key|p12)$/iu.test(entry.name), 'Credential artifacts are forbidden.');
    return entry.isDirectory() ? files(absolute, name + '/') : [{ name, bytes: readFileSync(absolute) }];
  });
}
const frontendFiles = files(hosting); assertFrontendFiles(frontendFiles.map(f => ({ name: f.name, text: f.bytes.toString('utf8') })));
assert(frontendFiles.some(f => f.bytes.includes(Buffer.from('STAGING'))));
const hashes = directory => Object.fromEntries(files(directory).map(f => [f.name, createHash('sha256').update(f.bytes).digest('hex')]).sort(([a], [b]) => a.localeCompare(b)));
for (const file of files(source)) {
  assert(/^(?:package(?:-lock)?\.json|vendor\/quiz-domain\/package\.json|(?:lib|vendor\/quiz-domain\/lib)\/.*\.(?:js|map|ts))$/u.test(file.name), 'Unexpected source artifact: ' + file.name);
  assert(!/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u.test(file.bytes.toString('utf8')), 'Private key material cannot be packaged.');
}
process.env.GCLOUD_PROJECT = STAGING_PROJECT;
process.env.FIREBASE_CONFIG = JSON.stringify({ projectId: STAGING_PROJECT, storageBucket: `${STAGING_PROJECT}.firebasestorage.app` });
const functions = await import(pathToFileURL(path.join(source, pkg.main)).href);
assert.deepEqual(Object.keys(functions).sort(), [...manifest.functions].sort());
for (const [name, fn] of Object.entries(functions)) {
  assert(fn.__endpoint && (fn.__endpoint.callableTrigger || fn.__endpoint.httpsTrigger), name + ': unexpected trigger');
  assert(!fn.__endpoint.secretEnvironmentVariables?.length, name + ': new secret bindings forbidden');
}
const { createRequire } = await import('node:module');
const packageRequire = createRequire(path.join(source, 'package.json'));
const functionsRoot = path.dirname(path.dirname(packageRequire.resolve('firebase-functions')));
const params = packageRequire(path.join(functionsRoot, 'params/index.js'));
assert.equal(params.declaredParams.length, 0, 'Targeted discovery must declare no cloud secrets or email configuration parameters.');
const base = JSON.parse(readFileSync('firebase.staging.json', 'utf8'));
const config = { functions: { ...base.functions, source }, firestore: { rules: path.join(root, manifest.firestoreRules), indexes: path.join(root, manifest.firestoreIndexes) }, hosting: { ...base.hosting, public: hosting } };
writeFileSync(path.join(destination, 'firebase.targeted.json'), JSON.stringify(config, null, 2));
const configPath = path.join(destination, 'firebase.targeted.json');
const phases = [manifest.functions.map(name => 'functions:' + name).join(','), 'firestore:rules', 'hosting'].map(only => ['deploy', '--project', STAGING_PROJECT, '--config', configPath, '--only', only, '--non-interactive']);
const receipt = { mode: 'PREPARED_NOT_DEPLOYED', sha, projectId: STAGING_PROJECT, source, hosting, configPath, functions: manifest.functions, sourceHashes: hashes(source), frontendHashes: hashes(hosting), phases, requiredPermissionException: { resources: manifest.newCallableFunctions, member: 'allUsers', role: 'roles/run.invoker', scope: 'Corresponding new Cloud Run services only' } };
assert.equal(git(['rev-parse', 'HEAD']), sha); assert.equal(git(['status', '--porcelain']), '');
writeFileSync(path.join(destination, 'receipt.json'), JSON.stringify(receipt, null, 2));
console.log(JSON.stringify({ mode: receipt.mode, sha, destination, functionCount: manifest.functions.length, frontendFileCount: frontendFiles.length }));
