import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, cpSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateInputs, targetedEntry, runtimeClosure, artifactPackage, assertArtifactPath, restartViteConfig, assertStagingBanner } from './restart-build-core.mjs';
import { STAGING_PROJECT } from './guard.mjs';
import { assertFrontendFiles, assertHostingOnlyConfig } from './hosting-only.mjs';

// Offline preparation only: no Firebase CLI, installation, cloud lookup or deployment.
const root = fileURLToPath(new URL('../../', import.meta.url));
const [sha, sdkPath, bucketPath, ...extra] = process.argv.slice(2);
assert(sha && sdkPath && bucketPath && extra.length === 0, 'Usage: build-restart.mjs <fullSHA> <sdk.json> <verified-bucket.json>');
const json = name => JSON.parse(readFileSync(name, 'utf8'));
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const sdk = json(path.resolve(sdkPath)), bucket = json(path.resolve(bucketPath));
const state = () => ({ sha, head: git('rev-parse', 'HEAD'), branch: git('branch', '--show-current'), status: git('status', '--porcelain', '--untracked-files=all'), node: process.versions.node, sdk, bucket });
const webEnv = validateInputs(state());
const manifest = json(path.join(root, 'tools/staging/restart-release-manifest.json'));
assert.equal(manifest.projectId, STAGING_PROJECT);
assert.equal(manifest.counts.releaseFunctions, 70);
assert.equal(manifest.region, 'europe-west1');
assert(!manifest.functions.includes('health') && !manifest.functions.some(name => Object.hasOwn(manifest.excludedFunctions, name)), 'Retained health and email endpoints must stay outside targeted release');
const entry = targetedEntry(readFileSync(path.join(root, manifest.runtime.sourceEntrypoint), 'utf8'), manifest.functions);
const pkg = artifactPackage(json(path.join(root, manifest.runtime.packageManifest)), json(path.join(root, manifest.runtime.packageLock)), manifest);
const destination = path.join(root, '.local-data/restart-release', sha);
assert(!existsSync(destination), 'Immutable artifact destination already exists; never overwrite it');
const work = path.join(root, '.local-data/restart-build', sha);
assert(!existsSync(work), 'Fresh build workspace required');
mkdirSync(work, { recursive: true });
mkdirSync(destination, { recursive: true });
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(?:PATH|SystemRoot|WINDIR|TEMP|TMP|COMSPEC|PATHEXT)$/iu.test(key)));
Object.assign(env, webEnv);
const run = (file, args, cwd = root) => execFileSync(process.execPath, [file, ...args], { cwd, env, stdio: 'inherit' });
const tsc = path.join(root, 'node_modules/typescript/bin/tsc');
const domain = path.join(work, 'domain');
run(tsc, ['-p', path.join(root, 'packages/quiz-domain/tsconfig.json'), '--outDir', domain, '--sourceMap', 'false']);
const config = path.join(work, 'functions-tsconfig.json');
writeFileSync(config, JSON.stringify({ extends: path.join(root, 'functions/tsconfig.json'), compilerOptions: { outDir: path.join(work, 'runtime'), sourceMap: false, paths: { '@filmovy-kviz/quiz-domain': [path.join(domain, 'index.d.ts')] } } }));
run(tsc, ['-p', config]);
const viteConfig = path.join(work, 'vite.config.mjs');
writeFileSync(viteConfig, restartViteConfig(root, domain, path.join(destination, 'hosting')));
run(path.join(root, 'apps/web/node_modules/vite/bin/vite.js'), ['build', '--mode', 'staging', '--config', viteConfig]);
const write = (name, bytes) => { assertArtifactPath(name); const target = path.join(destination, name); mkdirSync(path.dirname(target), { recursive: true }); writeFileSync(target, bytes, { flag: 'wx' }); };
for (const [name, bytes] of runtimeClosure(entry, name => readFileSync(path.join(work, 'runtime', name), 'utf8'), Object.keys(pkg.dependencies))) write('functions/lib/' + name, bytes);
write('functions/package.json', JSON.stringify(pkg, null, 2));
write('functions/package-lock.json', readFileSync(path.join(root, manifest.runtime.packageLock)));
const domainPkg = json(path.join(root, 'packages/quiz-domain/package.json')); delete domainPkg.scripts;
const domainLock = json(path.join(root, manifest.runtime.packageLock)).packages['vendor/quiz-domain'];
assert.equal(domainLock.version, domainPkg.version, 'Vendored domain version drift');
assert.equal(domainPkg.name, '@filmovy-kviz/quiz-domain');
write('functions/vendor/quiz-domain/package.json', JSON.stringify(domainPkg, null, 2));
function copyDomain(directory, prefix = '') {
  for (const item of readdirSync(directory, { withFileTypes: true })) {
    assert(!item.isSymbolicLink());
    const name = prefix + item.name;
    if (item.isDirectory()) copyDomain(path.join(directory, item.name), name + '/');
    else write('functions/vendor/quiz-domain/lib/' + name, readFileSync(path.join(directory, item.name)));
  }
}
copyDomain(domain);
for (const name of ['firestore.rules', 'storage.rules', 'firestore.indexes.json']) write(name, readFileSync(path.join(root, name)));
const hosting = json(path.join(root, 'firebase.staging.json')).hosting;
assertHostingOnlyConfig({ hosting });
const firebase = { functions: { source: 'functions', codebase: 'default', runtime: 'nodejs22' }, hosting: { ...hosting, public: 'hosting' }, firestore: { rules: 'firestore.rules', indexes: 'firestore.indexes.json' }, storage: { rules: 'storage.rules' } };
write('firebase.restart.json', JSON.stringify(firebase, null, 2));
cpSync(path.join(root, 'tools/staging/restart-release-manifest.json'), path.join(destination, 'release-inventory.json'));
const checksums = {}, frontend = [];
function inspect(directory, prefix = '') {
  for (const item of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    assert(!item.isSymbolicLink(), 'No artifact symlinks');
    const name = prefix + item.name;
    if (item.isDirectory()) inspect(path.join(directory, item.name), name + '/');
    else { assertArtifactPath(name); const bytes = readFileSync(path.join(directory, item.name)); checksums[name] = createHash('sha256').update(bytes).digest('hex'); if (name.startsWith('hosting/')) frontend.push({ name: name.slice(8), text: bytes.toString('utf8') }); }
  }
}
inspect(destination);
assertFrontendFiles(frontend);
assertStagingBanner(frontend);
validateInputs(state());
const phases = [manifest.functions.map(name => 'functions:' + name).join(','), 'firestore:rules', 'hosting'];
write('receipt.json', JSON.stringify({ mode: 'PREPARED_NOT_DEPLOYED', releaseSha: sha, branch: 'codex/restart-integration', projectId: STAGING_PROJECT, node: process.version, preparedAt: new Date().toISOString(), sdk, bucket, functions: manifest.functions, checksums, excludedFunctions: manifest.excludedFunctions, offlineOnly: true, cloudWritesApproved: false, deploymentRequiresSeparateApproval: true, localRuntimeVerificationRequired: { cwd: 'functions', installation: ['npm', 'ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], discovery: 'Separately import lib/index.js in a controlled local process; assert exactly the listed exports, inspect each __endpoint and firebase-functions declaredParams. This has not been run by the preparer.', runtimeAssets: 'Noto Sans WOFF assets resolve from the locked @fontsource/noto-sans package; no additional repository assets are required.', nodeModulesExcludedFromChecksums: true }, phases: phases.map(only => ['deploy', '--project', STAGING_PROJECT, '--config', 'firebase.restart.json', '--only', only, '--non-interactive']), phaseWorkingDirectory: destination, phaseGates: ['Approved current cloud inventory and explicit deployment authorization', 'Verify membership/lifecycle backend before Firestore Rules', 'Verify Firestore Rules and approved unchanged Storage Rules/indexes hashes before Hosting', 'Smoke and separate invitation activation approval'] }, null, 2));
console.log(JSON.stringify({ mode: 'PREPARED_NOT_DEPLOYED', releaseSha: sha, destination, functions: manifest.functions.length, fileCount: Object.keys(checksums).length, receiptSha256: createHash('sha256').update(readFileSync(path.join(destination, 'receipt.json'))).digest('hex') }));
