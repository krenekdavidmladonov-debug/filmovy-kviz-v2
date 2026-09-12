import assert from 'node:assert/strict';
import { editorReleaseFunctions, editorReleaseEntry, existingDependencies } from './editor-release-manifest.mjs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { assertStagingEnvironment, STAGING_PROJECT } from './guard.mjs';

assert.equal(process.versions.node.split('.')[0], '22');
assertStagingEnvironment(process.env);
assert.equal(process.env.VITE_ENABLE_TEAM_EMAIL, 'false', 'Editor candidate must disable email initialization');
const root = process.cwd();
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
assert.equal(git('status', '--porcelain'), '', 'Build requires a clean committed release HEAD');
const sha = git('rev-parse', 'HEAD');
const baseline = '10bea0de34d9939d02db374a0bbf8f2276fc9255';
assert.equal(git('branch', '--show-current'), 'codex/complete-quiz-editor');
const output = path.resolve('.local-data/complete-editor-release', sha);
const run = (file, args, cwd = root) => execFileSync(process.execPath, [file, ...args], { cwd, stdio: 'inherit' });
run('node_modules/typescript/bin/tsc', ['-p', 'packages/quiz-domain/tsconfig.json']);
run('node_modules/typescript/bin/tsc', ['-p', 'functions/tsconfig.json']);
run(path.resolve('apps/web/node_modules/vite/bin/vite.js'), ['build', '--mode', 'staging', '--outDir', path.join(output, 'hosting')], path.resolve('apps/web'));
const backend = path.join(output, 'functions');
mkdirSync(path.join(backend, 'lib'), { recursive: true });
cpSync('functions/lib', path.join(backend, 'lib'), { recursive: true, filter: source => !source.includes(path.sep + 'dev') });
writeFileSync(path.join(backend, 'lib/index.js'), editorReleaseEntry);
const pkg = JSON.parse(readFileSync('functions/package.json', 'utf8'));
delete pkg.scripts;
pkg.dependencies['@filmovy-kviz/quiz-domain'] = 'file:vendor/quiz-domain';
writeFileSync(path.join(backend, 'package.json'), JSON.stringify(pkg, null, 2));
cpSync('tools/staging/functions-package-lock.json', path.join(backend, 'package-lock.json'));
mkdirSync(path.join(backend, 'vendor/quiz-domain'), { recursive: true });
cpSync('packages/quiz-domain/lib', path.join(backend, 'vendor/quiz-domain/lib'), { recursive: true });
cpSync('packages/quiz-domain/package.json', path.join(backend, 'vendor/quiz-domain/package.json'));
const staging = JSON.parse(readFileSync('firebase.staging.json', 'utf8'));
assert.equal(staging.hosting.site, STAGING_PROJECT);
const config = { functions: { source: backend, codebase: 'default', runtime: 'nodejs22' }, hosting: { ...staging.hosting, public: path.join(output, 'hosting') }, storage: { rules: path.join(output, 'storage.rules') } };
assert(!config.functions.predeploy && !config.functions.postdeploy && !config.hosting.predeploy && !config.hosting.postdeploy);
cpSync('storage.rules', path.join(output, 'storage.rules'));
writeFileSync(path.join(output, 'firebase.complete-editor.json'), JSON.stringify(config, null, 2));
const checksums = {};
function inspect(dir, prefix = '') {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    assert(!entry.isSymbolicLink());
    const relative = prefix + entry.name;
    if (entry.isDirectory()) inspect(path.join(dir, entry.name), relative + '/');
    else if (relative !== 'manifest.json') checksums[relative] = createHash('sha256').update(readFileSync(path.join(dir, entry.name))).digest('hex');
  }
}
inspect(output);
const configuration = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.startsWith('VITE_') && key !== 'VITE_FIREBASE_API_KEY'));
writeFileSync(path.join(output, 'manifest.json'), JSON.stringify({ builtAt: new Date().toISOString(), releaseSha: sha,
  baseMainSha: '0d452d8efe4cce9eb003fcce713d3b63c15bb0a4',
  sourcePrSha: 'c92a8b5211b11ce438498fb934a2ddff04c186bb', stagingFrontendSha: baseline,
  stagingRelease: '1789157941594000', stagingVersion: '90df28ec3c46ec01',
  componentSources: { frontend: sha, editorFunctions: sha, editorBaseline: baseline, domain: sha },
  functionsExports: editorReleaseFunctions, existingDependencies,
  excludedFunctions: ['dispatchRegistrationEmail','deliverEmailTask','previewEventTeamMessage','createEventTeamMessage','listEventTeamMessages','getEventTeamMessage'],
  storage: { bucket: 'filmovy-kviz-v2-staging.firebasestorage.app', observedExisting: false, proposedLocation: 'europe-west1', access: 'immutable upload grants and authenticated gateway; no public bucket reads' },
  firestore: { rulesChanged: false, indexesChanged: false },
  configuration, node: process.version, checksums,
}, null, 2));
assert.equal(git('rev-parse', 'HEAD'), sha);
assert.equal(git('status', '--porcelain'), '');
console.log(`BUILD ONLY: ${path.join(output, 'manifest.json')}`);
