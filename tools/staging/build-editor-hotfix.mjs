import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { assertStagingEnvironment, STAGING_PROJECT } from './guard.mjs';

assert.equal(process.versions.node.split('.')[0], '22');
assertStagingEnvironment(process.env);
const root = process.cwd();
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
assert.equal(git('status', '--porcelain'), '', 'Build requires a clean committed release HEAD');
const sha = git('rev-parse', 'HEAD');
const baseline = 'edc659ec0137e626c4b7dba63d4eab7211d66cfa';
assert.equal(git('branch', '--show-current'), 'release/staging-editor-core-hotfix');
const output = path.resolve('.local-data/editor-hotfix-release', sha);
const run = (file, args, cwd = root) => execFileSync(process.execPath, [file, ...args], { cwd, stdio: 'inherit' });
run('node_modules/typescript/bin/tsc', ['-p', 'packages/quiz-domain/tsconfig.json']);
run('node_modules/typescript/bin/tsc', ['-p', 'functions/tsconfig.json']);
run(path.resolve('apps/web/node_modules/vite/bin/vite.js'), ['build', '--mode', 'staging', '--outDir', path.join(output, 'hosting')], path.resolve('apps/web'));
const backend = path.join(output, 'functions');
mkdirSync(path.join(backend, 'lib'), { recursive: true });
cpSync('functions/lib/editor', path.join(backend, 'lib/editor'), { recursive: true });
writeFileSync(path.join(backend, 'lib/index.js'), "export { updateQuizSlide, createQuiz } from './editor/callables.js';\n");
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
const config = { functions: { source: backend, codebase: 'default', runtime: 'nodejs22' }, hosting: { ...staging.hosting, public: path.join(output, 'hosting') } };
assert(!config.functions.predeploy && !config.functions.postdeploy && !config.hosting.predeploy && !config.hosting.postdeploy);
writeFileSync(path.join(output, 'firebase.editor-hotfix.json'), JSON.stringify(config, null, 2));
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
  sourcePrSha: 'c92a8b5211b11ce438498fb934a2ddff04c186bb', stagingFrontendSha: baseline,
  stagingRelease: '1788981978655000', stagingVersion: '9d3b3fcd4c7eb916',
  componentSources: { frontend: sha, editorFunctions: sha, editorBaseline: baseline, domain: sha },
  deployedEditorSourceGeneration: '1788779594382062', deployedEditorFunctionsHash: '8e5c1eefed4658cf6f76d67abf69279008f84cc4',
  functionsExports: ['updateQuizSlide', 'createQuiz'], configuration, node: process.version, checksums,
}, null, 2));
assert.equal(git('rev-parse', 'HEAD'), sha);
assert.equal(git('status', '--porcelain'), '');
console.log(`BUILD ONLY: ${path.join(output, 'manifest.json')}`);
