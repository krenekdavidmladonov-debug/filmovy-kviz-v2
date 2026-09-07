import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertStagingEnvironment, assertStagingProject, STAGING_PROJECT, STAGING_URL } from './guard.mjs';
import { stagingWebConfig } from './cloud.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
process.chdir(root);
assertStagingProject(process.argv[2]);
if (process.argv.length !== 3) throw new Error('Usage: node tools/staging/deploy.mjs filmovy-kviz-v2-staging');
if (Number(process.versions.node.split('.')[0]) !== 22) throw new Error('Node 22 required.');
const branch = spawnSync('git', ['branch', '--show-current'], { encoding: 'utf8' });
if (branch.status !== 0 || !branch.stdout.trim()) throw new Error('A named Git branch is required.');
console.log(`Branch: ${branch.stdout.trim()}\nTarget: ${STAGING_PROJECT}`);
const config = JSON.parse(readFileSync('firebase.staging.json', 'utf8'));
if (config.hosting.site !== STAGING_PROJECT || config.functions.source !== '.local-data/staging/functions' ||
    config.hosting.public !== 'apps/web/dist' || config.storage || config.functions.predeploy) throw new Error('Unexpected deploy configuration.');
const sdk = await stagingWebConfig();
const env = { ...process.env, VITE_APP_ENV: 'staging', VITE_FIREBASE_API_KEY: sdk.apiKey,
  VITE_FIREBASE_AUTH_DOMAIN: sdk.authDomain, VITE_FIREBASE_PROJECT_ID: sdk.projectId,
  VITE_FIREBASE_STORAGE_BUCKET: `${STAGING_PROJECT}.firebasestorage.app`,
  VITE_FIREBASE_MESSAGING_SENDER_ID: sdk.messagingSenderId, VITE_FIREBASE_APP_ID: sdk.appId,
  VITE_FIREBASE_USE_EMULATORS: 'false', VITE_FIREBASE_ALLOW_NON_DEMO_PROJECT: 'true' };
assertStagingEnvironment(env);
function run(file, args, cwd = root) {
  const result = spawnSync(process.execPath, [file, ...args], { cwd, env, stdio: 'inherit' });
  if (result.status !== 0) throw new Error('Staging command failed; deployment stopped.');
}
const tsc = path.join(root, 'node_modules/typescript/bin/tsc');
run(tsc, ['-p', 'packages/quiz-domain/tsconfig.json']);
run(tsc, ['-p', 'functions/tsconfig.json']);
run(path.join(root, 'apps/web/node_modules/vite/bin/vite.js'), ['build', '--mode', 'staging'], path.join(root, 'apps/web'));

// Self-contained generated source package. No workspace symlinks, seeds, or local credentials are uploaded.
const output = path.join(root, config.functions.source);
mkdirSync(output, { recursive: true });
cpSync('functions/lib', path.join(output, 'lib'), { recursive: true, filter: (source) => !source.split(path.sep).includes('dev') });
const domain = path.join(output, 'vendor/quiz-domain');
mkdirSync(domain, { recursive: true });
cpSync('packages/quiz-domain/lib', path.join(domain, 'lib'), { recursive: true });
cpSync('packages/quiz-domain/package.json', path.join(domain, 'package.json'));
const pkg = JSON.parse(readFileSync('functions/package.json', 'utf8'));
delete pkg.scripts;
pkg.dependencies['@filmovy-kviz/quiz-domain'] = 'file:vendor/quiz-domain';
writeFileSync(path.join(output, 'package.json'), JSON.stringify(pkg, null, 2));
cpSync('tools/staging/functions-package-lock.json', path.join(output, 'package-lock.json'));
const npm = path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
run(npm, ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], output);
run(path.join(root, 'node_modules/firebase-tools/lib/bin/firebase.js'), [
  'deploy', '--project', STAGING_PROJECT, '--config', 'firebase.staging.json',
  '--only', 'firestore:rules,firestore:indexes,functions,hosting', '--non-interactive',
]);
console.log(`STAGING: ${STAGING_URL}`);
