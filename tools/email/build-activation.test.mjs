import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { artifactPackage } from '../staging/restart-build-core.mjs';
import { TARGETS, artifactPath, assertInputBindings, compilerEnvironment, emailClosure, emailEntry, freshOutput, inspectArtifact, parseArguments, unlinkedPath, validateSource } from './build-activation.mjs';

const root = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const fixtureParent = path.join(root, '.local-data/email-artifact-tests');
mkdirSync(fixtureParent, { recursive: true });
const fixture = mkdtempSync(path.join(fixtureParent, 'synthetic-'));
const source = `export { getEventRegistration, cancelEventRegistration, createEventRegistration, updateEventRegistration } from './registrations/callables.js';\nexport { dispatchRegistrationEmail, deliverEmailTask } from './email/worker.js';\nexport { previewEventTeamMessage } from './email/team-callables.js';\nexport const health = 1;\n`;
const packages = ['firebase-admin', 'firebase-functions', '@filmovy-kviz/quiz-domain'];
const input = { sha: 'a'.repeat(40), head: 'a'.repeat(40), branch: 'codex/synthetic-email-package', status: '', node: '22.20.0' };

test('exact SHA, clean source, Node 22 and any dedicated branch required', () => {
  validateSource(input);
  validateSource({ ...input, branch: 'feature/other-dedicated-branch' });
  for (const patch of [{ sha: 'abc' }, { head: 'b'.repeat(40) }, { branch: '' }, { branch: 'main' }, { branch: 'master' }, { status: '?? synthetic.txt' }, { status: ' M functions/src/index.ts' }, { node: '24.0.0' }]) assert.throws(() => validateSource({ ...input, ...patch }));
});

test('CLI accepts only explicit SHA/output; credentials and config inputs have no interface', () => {
  assert.deepEqual(parseArguments(['--source-sha', input.sha, '--out', '.local-data/example/new']), { sha: input.sha, output: '.local-data/example/new' });
  for (const args of [[], ['--source-sha', input.sha], ['--source-sha', input.sha, '--source-sha', input.sha], ['--source-sha', input.sha, '--credentials', 'synthetic.json'], ['--source-sha', input.sha, '--out', '--input'], ['--source-sha', input.sha, '--out', 'new', '--sdk', 'synthetic.json']]) assert.throws(() => parseArguments(args));
});

test('entry contains exactly the five fixed targets and no health/team exports', () => {
  const entry = emailEntry(source);
  assert.equal(TARGETS.length, 5);
  assert(entry.includes('dispatchRegistrationEmail, deliverEmailTask'));
  for (const excluded of ['getEventRegistration', 'health', 'previewEventTeamMessage', 'team-callables']) assert(!entry.includes(excluded));
  assert.throws(() => emailEntry(source.replace('deliverEmailTask', 'differentWorker')));
  assert.throws(() => emailEntry(source + "export { deliverEmailTask } from './email/worker.js';"));
  assert.throws(() => emailEntry(source.replace('./email/worker.js', './dev/fake-worker.js')));
});

test('closure follows shared relative helpers and allowlisted runtime packages, omitting unrelated files', () => {
  const modules = {
    'registrations/callables.js': "import { onCall } from 'firebase-functions/v2/https'; import { model } from '../events/model.js';",
    'events/model.js': "import { brand } from '@filmovy-kviz/quiz-domain';",
    'email/worker.js': "import { task } from './task.js'; import 'firebase-admin/app';",
    'email/task.js': "import { randomUUID } from 'node:crypto'; import './team-message.js';",
    'email/team-message.js': 'export const sharedTemplateHelper = 1;',
    'email/team-callables.js': 'export const excluded = 1;',
  };
  const files = emailClosure(emailEntry(source), name => modules[name], packages);
  assert.deepEqual([...files.keys()].sort(), ['index.js', 'registrations/callables.js', 'events/model.js', 'email/worker.js', 'email/task.js', 'email/team-message.js'].sort());
  assert(!files.has('email/team-callables.js'));
});

test('closure fails closed on escape, excluded modules, dev helpers, missing files and new packages', () => {
  for (const module of ['../escape.js', './dev/fake.js', './email/team-callables.js', './health.js', './index.js', './extra.map', './windows\\escape.js']) assert.throws(() => emailClosure(`import '${module}';`, () => '', packages));
  for (const statement of ["import 'unknown-package';", "import 'node:imaginary';", 'import(runtimePath);', "import('./helper.js' + suffix);", "import('./helper.js', { extra: true });", "require('firebase-admin');", "//# sourceMappingURL=worker.js.map"]) assert.throws(() => emailClosure(statement, () => '', packages));
  assert.throws(() => emailClosure("import './missing.js';", () => undefined, packages));
});

test('compiler receives no ambient credentials, runtime values, parent PATH or Node preload', () => {
  const environment = compilerEnvironment({ SystemRoot: 'synthetic-os-root', WINDIR: 'synthetic-os-root', PATH: 'synthetic', GOOGLE_APPLICATION_CREDENTIALS: 'synthetic.json', NODE_OPTIONS: '--require=synthetic', FIREBASE_TOKEN: 'synthetic', REGISTRATION_EMAIL_MODE: 'staging', GMAIL_OAUTH_REFRESH_TOKEN: 'synthetic', HOME: 'synthetic-owner-home' }, '/synthetic-temp', 'linux');
  assert.deepEqual(environment, { SystemRoot: 'synthetic-os-root', WINDIR: 'synthetic-os-root', TEMP: '/synthetic-temp', TMP: '/synthetic-temp', HOME: '/synthetic-temp', USERPROFILE: '/synthetic-temp' });
  const windows = compilerEnvironment({ PATH: 'parent-path', USERNAME: 'parent-user', USERDOMAIN: 'parent-domain', LOGONSERVER: 'parent-server', HOMEDRIVE: 'Z:', HOMEPATH: '\\parent-home', SYSTEMDRIVE: 'Z:' }, 'C:\\synthetic\\temp', 'win32');
  assert.deepEqual(windows, { TEMP: 'C:\\synthetic\\temp', TMP: 'C:\\synthetic\\temp', HOME: 'C:\\synthetic\\temp', USERPROFILE: 'C:\\synthetic\\temp', PATH: 'C:\\synthetic\\temp',
    HOMEDRIVE: 'C:', HOMEPATH: '\\synthetic\\temp', SYSTEMDRIVE: 'C:', USERNAME: 'LOCAL_SYNTHETIC', USERDOMAIN: 'LOCAL_SYNTHETIC', LOGONSERVER: '\\\\LOCAL_SYNTHETIC' });
  assert.throws(() => compilerEnvironment({}, 'relative-temp', 'win32'));
});

test('real no-import Node child has exact closed environment despite synthetic parent values', () => {
  const temporary = path.join(fixture, 'child-environment-temp'); mkdirSync(temporary);
  const fakeParent = { PATH: 'PARENT_SYNTHETIC_PATH', USERNAME: 'PARENT_SYNTHETIC_USER', USERDOMAIN: 'PARENT_SYNTHETIC_DOMAIN', LOGONSERVER: 'PARENT_SYNTHETIC_SERVER',
    HOMEDRIVE: 'Z:', HOMEPATH: '\\PARENT_SYNTHETIC_HOME', SYSTEMDRIVE: 'Z:', HOME: 'PARENT_SYNTHETIC_HOME', USERPROFILE: 'PARENT_SYNTHETIC_PROFILE',
    GOOGLE_APPLICATION_CREDENTIALS: 'PARENT_SYNTHETIC_CREDENTIAL.json', GMAIL_OAUTH_REFRESH_TOKEN: 'PARENT_SYNTHETIC_TOKEN', FIREBASE_TOKEN: 'PARENT_SYNTHETIC_TOKEN', NODE_OPTIONS: '--require=PARENT_SYNTHETIC_PRELOAD_MUST_NOT_RUN' };
  const original = Object.fromEntries(Object.keys(fakeParent).map(key => [key, process.env[key]]));
  try {
    Object.assign(process.env, fakeParent);
    const environment = compilerEnvironment(process.env, temporary);
    // No imports, SDK, file access or network: compare in child and emit only booleans.
    const code = `const canonical = environment => Object.fromEntries(Object.entries(environment).map(([key,value]) => [process.platform === 'win32' ? key.toUpperCase() : key,value]).sort(([a],[b]) => a.localeCompare(b))); const expected = canonical(JSON.parse(process.argv[1])); const actual = canonical(process.env); const passed = JSON.stringify(actual) === JSON.stringify(expected); process.stdout.write(JSON.stringify({passed, applicationImported:false, credentialsRead:false})); if (!passed) process.exitCode = 1;`;
    const result = spawnSync(process.execPath, ['--eval', code, JSON.stringify(environment)], { cwd: temporary, env: environment, windowsHide: true, encoding: 'utf8', timeout: 10_000 });
    assert.equal(result.error?.code, undefined, 'Synthetic no-import child must spawn');
    assert.equal(result.status, 0, 'Synthetic no-import child must match the closed environment');
    assert.deepEqual(JSON.parse(result.stdout), { passed: true, applicationImported: false, credentialsRead: false });
  } finally {
    for (const [key, value] of Object.entries(original)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});

test('fresh output is ignored, immutable and scoped away from sensitive paths', () => {
  const destination = path.join(fixture, 'new-package');
  assert.equal(freshOutput(root, destination), destination);
  mkdirSync(destination);
  assert.throws(() => freshOutput(root, destination));
  for (const destination of [root, path.join(root, 'tools/new-artifact'), path.join(root, '.local-data/../outside'), path.join(fixture, '.env-output'), path.join(fixture, 'credentials-output')]) assert.throws(() => freshOutput(root, destination));
});

test('input/output ancestor symlinks and dangling links are refused', context => {
  const target = path.join(fixture, 'link-target'); mkdirSync(target);
  const link = path.join(fixture, 'linked');
  try { symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) { context.skip('OS did not allow synthetic symlink creation'); return; } throw error; }
  assert.throws(() => freshOutput(root, path.join(link, 'new')));
  assert.throws(() => unlinkedPath(root, link));
  const dangling = path.join(fixture, 'dangling');
  symlinkSync(path.join(fixture, 'missing-link-target'), dangling, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => freshOutput(root, dangling));
});

test('artifact allowlist rejects Hosting/Rules/Storage, maps, dependencies and excluded runtime', () => {
  for (const name of ['functions/lib/index.js', 'functions/lib/email/worker.js', 'functions/vendor/quiz-domain/lib/index.d.ts', 'functions/package.json', 'functions/package-lock.json', 'receipt.json']) artifactPath(name);
  for (const name of ['hosting/index.html', 'firestore.rules', 'storage.rules', 'firebase.json', 'functions/.env', 'functions/node_modules/firebase-admin/index.js', 'functions/lib/email/team-callables.js', 'functions/lib/dev/fake.js', 'functions/lib/health.js', 'functions/lib/worker.js.map', 'functions/lib/../worker.js', '/functions/lib/worker.js', 'functions/lib/credentials.js']) assert.throws(() => artifactPath(name));
});

test('artifact inspection checks exact file set and content hashes before receipt', () => {
  const directory = path.join(fixture, 'inspect'); mkdirSync(path.join(directory, 'functions/lib'), { recursive: true });
  writeFileSync(path.join(directory, 'functions/lib/index.js'), emailEntry(source));
  const hashes = inspectArtifact(directory, ['functions/lib/index.js']);
  assert.match(hashes['functions/lib/index.js'], /^[a-f0-9]{64}$/u);
  mkdirSync(path.join(directory, 'hosting'));
  assert.throws(() => inspectArtifact(directory, ['functions/lib/index.js']));
  rmdirSync(path.join(directory, 'hosting'));
  assert.throws(() => inspectArtifact(directory, ['functions/lib/index.js', 'receipt.json']));
  writeFileSync(path.join(directory, 'receipt.json'), '{}');
  assert.throws(() => inspectArtifact(directory, ['functions/lib/index.js']));
  writeFileSync(path.join(directory, 'unrelated.txt'), 'synthetic');
  assert.throws(() => inspectArtifact(directory, ['functions/lib/index.js', 'receipt.json', 'unrelated.txt']));
});

test('reuse locked packaging removes scripts and fails on dependency/lock drift', () => {
  const pkg = { name: 'synthetic-functions', version: '1.0.0', engines: { node: '22' }, scripts: { build: 'synthetic-do-not-run' }, dependencies: { '@filmovy-kviz/quiz-domain': 'workspace:*', 'firebase-admin': '^13.4.0' } };
  const lock = { packages: { '': { name: pkg.name, version: pkg.version, engines: pkg.engines, dependencies: { ...pkg.dependencies, '@filmovy-kviz/quiz-domain': 'file:vendor/quiz-domain' } }, 'node_modules/@filmovy-kviz/quiz-domain': { resolved: 'vendor/quiz-domain' } } };
  const manifest = { runtime: { packages: pkg.dependencies } };
  const result = artifactPackage(pkg, lock, manifest);
  assert(!Object.hasOwn(result, 'scripts'));
  assert.equal(result.dependencies['@filmovy-kviz/quiz-domain'], 'file:vendor/quiz-domain');
  assert.equal(pkg.dependencies['@filmovy-kviz/quiz-domain'], 'workspace:*');
  assert.throws(() => artifactPackage({ ...pkg, dependencies: { ...pkg.dependencies, extra: '1' } }, lock, manifest));
  assert.throws(() => artifactPackage(pkg, { packages: { ...lock.packages, '': { ...lock.packages[''], version: 'changed' } } }, manifest));
});

test('input drift stops completion, even with an unchanged HEAD', () => {
  const before = { 'functions/src/index.ts': 'synthetic-hash', 'pnpm-lock.yaml': 'synthetic-lock' };
  assertInputBindings(before, structuredClone(before));
  assert.throws(() => assertInputBindings(before, { ...before, 'pnpm-lock.yaml': 'changed' }));
  assert.throws(() => assertInputBindings(before, { ...before, 'extra.ts': 'extra' }));
});

test('synthetic fixture log and cleanup stay inside this worker fixture', () => {
  const log = path.join(fixture, 'synthetic-check.json');
  writeFileSync(log, JSON.stringify({ mode: 'SYNTHETIC_ONLY', cloudCalls: 0, compilerInvocations: 0, credentialReads: 0 }));
  assert.equal(JSON.parse(readFileSync(log, 'utf8')).compilerInvocations, 0);
  assert(path.resolve(fixture).startsWith(path.resolve(fixtureParent) + path.sep));
  // Preserve the small evidence log; fixtures contain only generated test strings.
  for (const directory of ['new-package', 'inspect', 'linked', 'dangling', 'link-target']) rmSync(path.join(fixture, directory), { recursive: true, force: true });
});
