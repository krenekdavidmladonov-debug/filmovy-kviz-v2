import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { artifactPackage } from '../staging/restart-build-core.mjs';

// Offline compiler/packager only. Never load the compiled Functions module.
const root = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const mapping = Object.freeze({
  createEventRegistration: './registrations/callables.js',
  updateEventRegistration: './registrations/callables.js',
  cancelEventRegistration: './registrations/callables.js',
  dispatchRegistrationEmail: './email/worker.js',
  deliverEmailTask: './email/worker.js',
});
export const TARGETS = Object.freeze(Object.keys(mapping));
const secrets = ['EMAIL_TOKEN_KEYRING', 'GMAIL_OAUTH_CLIENT_ID', 'GMAIL_OAUTH_CLIENT_SECRET', 'GMAIL_OAUTH_REFRESH_TOKEN'];
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const inside = (parent, child) => { const relative = path.relative(parent, child); return relative !== '' && !relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative); };

export function validateSource({ sha, head, branch, status, node }) {
  assert.match(sha ?? '', /^[a-f0-9]{40}$/u, 'Full source SHA required');
  assert.equal(head, sha, 'HEAD differs from source SHA');
  assert(branch && !['main', 'master'].includes(branch), 'Dedicated branch required');
  assert.equal(status, '', 'Tracked and untracked source must be clean');
  assert.equal(node.split('.')[0], '22', 'Node 22 required');
}

export function parseArguments(args) {
  assert.equal(args.length, 4, 'Only --source-sha <fullSHA> --out <new .local-data directory> accepted');
  const flags = {};
  for (let i = 0; i < args.length; i += 2) {
    assert(['--source-sha', '--out'].includes(args[i]) && !Object.hasOwn(flags, args[i]) && args[i + 1] && !args[i + 1].startsWith('--'), 'Invalid arguments');
    flags[args[i]] = args[i + 1];
  }
  return { sha: flags['--source-sha'], output: flags['--out'] };
}

// Check every existing ancestor, including junctions; allow a missing final path.
export function unlinkedPath(base, candidate, { fresh = false } = {}) {
  const absolute = path.resolve(candidate);
  assert(inside(base, absolute), 'Path escapes expected root');
  let current = base;
  assert(!lstatSync(current).isSymbolicLink(), 'Linked root refused');
  for (const part of path.relative(base, absolute).split(path.sep)) {
    current = path.join(current, part);
    let info;
    try { info = lstatSync(current); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    assert(!info?.isSymbolicLink(), 'Symlink or junction refused');
  }
  if (fresh) assert(!existsSync(absolute), 'Immutable destination already exists');
  return absolute;
}

export function freshOutput(repository, candidate) {
  const absolute = unlinkedPath(repository, candidate, { fresh: true });
  assert(inside(path.join(repository, '.local-data'), absolute), 'Output must be under ignored .local-data');
  assert(!path.relative(repository, absolute).split(path.sep).some(part => /^(?:\.env)|credential|service.?account|\.(?:pem|key)$/iu.test(part)), 'Sensitive output path refused');
  return absolute;
}

export function compilerEnvironment(environment, temporaryDirectory) {
  const safe = Object.fromEntries(Object.entries(environment).filter(([key]) => /^(?:SystemRoot|WINDIR)$/iu.test(key)));
  return { ...safe, TEMP: temporaryDirectory, TMP: temporaryDirectory, HOME: temporaryDirectory, USERPROFILE: temporaryDirectory };
}

export function emailEntry(source) {
  const found = [];
  for (const match of source.matchAll(/export\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/gu)) {
    for (const name of match[1].split(',').map(value => value.trim()).filter(Boolean)) {
      if (Object.hasOwn(mapping, name)) { assert.equal(match[2], mapping[name], 'Target module drift'); found.push(name); }
    }
  }
  assert.deepEqual(found.sort(), [...TARGETS].sort(), 'Exactly one source export per email target required');
  return `export { createEventRegistration, updateEventRegistration, cancelEventRegistration } from './registrations/callables.js';\nexport { dispatchRegistrationEmail, deliverEmailTask } from './email/worker.js';\n`;
}

function runtimeName(name) {
  assert.match(name, /^(?:[a-z0-9-]+\/)*[a-z0-9-]+\.js$/u, 'Invalid compiled runtime path');
  assert(!name.split('/').includes('dev') && !['index.js', 'health.js', 'email/team-callables.js'].includes(name), 'Excluded runtime module');
}

export function emailClosure(entry, read, packages) {
  const files = new Map([['index.js', entry]]), pending = ['index.js'];
  while (pending.length) {
    const name = pending.pop(), text = files.get(name);
    assert(!/\brequire\s*\(|\bimport\s*\((?!\s*['"])|sourceMappingURL/u.test(text), 'Unsupported runtime loading or source map');
    for (const match of text.matchAll(/\bimport\s*\(([^)]*)\)/gu)) assert.match(match[1], /^\s*['"][^'"]+['"]\s*$/u, 'Only exact literal dynamic imports accepted');
    for (const match of text.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)['"]([^'"]+)['"]/gu)) {
      const dependency = match[1];
      if (!dependency.startsWith('.')) {
        const packageName = dependency.startsWith('@') ? dependency.split('/').slice(0, 2).join('/') : dependency.split('/')[0];
        assert(dependency.startsWith('node:') ? builtinModules.includes(dependency.slice(5)) : packages.includes(packageName), 'Uninventoried runtime package');
        continue;
      }
      assert(!dependency.includes('\\'), 'Invalid import separator');
      const relative = path.posix.normalize(path.posix.join(path.posix.dirname(name), dependency));
      runtimeName(relative);
      if (!files.has(relative)) { const bytes = read(relative); assert.equal(typeof bytes, 'string'); files.set(relative, bytes); pending.push(relative); }
    }
  }
  return files;
}

export function artifactPath(name) {
  assert(!name.includes('\\') && !name.split('/').includes('..') && !name.startsWith('/'), 'Artifact path escape');
  assert(!/(?:^|\/)(?:dev|tests?|fixtures?|node_modules|\.env[^/]*|[^/]*credential[^/]*|[^/]*service[-_]?account[^/]*)(?:\/|$)|\.(?:map|pem|key|p12)$/iu.test(name), 'Forbidden artifact file');
  assert(/^(?:functions\/(?:lib\/(?:[a-z0-9-]+\/)*[a-z0-9-]+\.js|vendor\/quiz-domain\/(?:package\.json|lib\/(?:[a-z0-9-]+\/)*[a-z0-9-]+\.(?:js|d\.ts))|package(?:-lock)?\.json)|receipt\.json)$/u.test(name), 'Functions-only artifact scope required');
  assert(!/\/(?:health|team-callables)\.js$/u.test(name), 'Excluded artifact module');
}

export function inspectArtifact(directory, expected) {
  const hashes = {};
  function walk(current, prefix = '') {
    for (const item of readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      assert(!item.isSymbolicLink(), 'Artifact symlink refused');
      const name = prefix + item.name;
      if (item.isDirectory()) { assert([...expected].some(file => file.startsWith(name + '/')), 'Unexpected artifact directory'); walk(path.join(current, item.name), name + '/'); }
      else { assert(item.isFile(), 'Non-file artifact refused'); artifactPath(name); hashes[name] = digest(readFileSync(path.join(current, item.name))); }
    }
  }
  walk(directory);
  assert.deepEqual(Object.keys(hashes).sort(), [...expected].sort(), 'Unexpected or missing artifact file');
  return hashes;
}

export function assertInputBindings(before, after) {
  assert.deepEqual(after, before, 'Build input drift; artifact is incomplete');
}

function main() {
  const { sha, output } = parseArguments(process.argv.slice(2));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const state = () => ({ sha, head: git('rev-parse', 'HEAD'), branch: git('branch', '--show-current'), status: git('status', '--porcelain', '--untracked-files=all'), node: process.versions.node });
  validateSource(state());
  const destination = freshOutput(root, path.resolve(root, output));
  const work = freshOutput(root, destination + '.work');
  const tracked = git('ls-files', '-z').split('\0').filter(Boolean).sort();
  const bindings = () => Object.fromEntries(tracked.map(name => [name, digest(readFileSync(unlinkedPath(root, path.join(root, name))))]));
  const before = bindings();
  const read = name => readFileSync(unlinkedPath(root, path.join(root, name)), 'utf8');
  const json = name => JSON.parse(read(name));
  const manifest = json('tools/staging/restart-release-manifest.json');
  assert.equal(manifest.projectId, 'filmovy-kviz-v2-staging');
  assert.equal(manifest.region, 'europe-west1');
  assert.equal(manifest.counts.releaseFunctions, 70);
  const entry = emailEntry(read('functions/src/index.ts'));
  const lock = json('tools/staging/functions-package-lock.json');
  const pkg = artifactPackage(json('functions/package.json'), lock, manifest);
  const domainPackage = json('packages/quiz-domain/package.json');
  assert.equal(domainPackage.name, '@filmovy-kviz/quiz-domain');
  assert.equal(domainPackage.version, lock.packages['vendor/quiz-domain'].version);
  delete domainPackage.scripts;
  // Resolve pnpm's compiler junction, then require its physical files in local node_modules.
  const compilerDirectory = realpathSync(path.join(root, 'node_modules/typescript'));
  assert(inside(path.join(root, 'node_modules'), compilerDirectory), 'Installed compiler must stay inside local dependencies');
  const compiler = unlinkedPath(compilerDirectory, path.join(compilerDirectory, 'bin/tsc'));
  const compilerPackage = JSON.parse(readFileSync(unlinkedPath(compilerDirectory, path.join(compilerDirectory, 'package.json')), 'utf8'));
  const lockedCompiler = read('pnpm-lock.yaml').match(/\n {6}typescript:\r?\n {8}specifier: [^\r\n]+\r?\n {8}version: ([0-9.]+)\r?\n/u)?.[1];
  assert.equal(compilerPackage.version, lockedCompiler, 'Installed compiler version differs from lock');
  assert(lockedCompiler, 'Locked compiler required; never install automatically');
  mkdirSync(work, { recursive: true });
  mkdirSync(destination, { recursive: true });
  const temporary = path.join(work, 'temp'); mkdirSync(temporary);
  const env = compilerEnvironment(process.env, temporary);
  const run = config => execFileSync(process.execPath, [compiler, '-p', config, '--pretty', 'false'], { cwd: work, env, stdio: 'inherit' });
  const domain = path.join(work, 'domain'), runtime = path.join(work, 'runtime');
  const domainConfig = path.join(work, 'domain-tsconfig.json');
  writeFileSync(domainConfig, JSON.stringify({ extends: path.join(root, 'packages/quiz-domain/tsconfig.json'), compilerOptions: { outDir: domain, sourceMap: false, declarationMap: false, incremental: false } }), { flag: 'wx' });
  run(domainConfig);
  const functionsConfig = path.join(work, 'functions-tsconfig.json');
  writeFileSync(functionsConfig, JSON.stringify({ extends: path.join(root, 'functions/tsconfig.json'), compilerOptions: { outDir: runtime, sourceMap: false, declarationMap: false, incremental: false, paths: { '@filmovy-kviz/quiz-domain': [path.join(domain, 'index.d.ts')] } } }), { flag: 'wx' });
  run(functionsConfig);
  const expected = [];
  const write = (name, bytes) => { artifactPath(name); const target = unlinkedPath(destination, path.join(destination, name), { fresh: true }); mkdirSync(path.dirname(target), { recursive: true }); writeFileSync(target, bytes, { flag: 'wx', mode: 0o600 }); expected.push(name); };
  for (const [name, bytes] of emailClosure(entry, name => readFileSync(unlinkedPath(runtime, path.join(runtime, name)), 'utf8'), Object.keys(pkg.dependencies))) write('functions/lib/' + name, bytes);
  write('functions/package.json', JSON.stringify(pkg, null, 2));
  write('functions/package-lock.json', read('tools/staging/functions-package-lock.json'));
  write('functions/vendor/quiz-domain/package.json', JSON.stringify(domainPackage, null, 2));
  function copyDomain(directory, prefix = '') {
    for (const item of readdirSync(directory, { withFileTypes: true })) {
      assert(!item.isSymbolicLink(), 'Domain symlink refused');
      const name = prefix + item.name;
      if (item.isDirectory()) copyDomain(path.join(directory, item.name), name + '/');
      else { assert(item.isFile()); write('functions/vendor/quiz-domain/lib/' + name, readFileSync(path.join(directory, item.name))); }
    }
  }
  copyDomain(domain);
  const checksums = inspectArtifact(destination, expected);
  validateSource(state());
  assertInputBindings(before, bindings());
  write('receipt.json', JSON.stringify({ schemaVersion: 1, mode: 'PREPARATION_ONLY', sourceSha: sha, branch: state().branch, projectId: manifest.projectId, region: manifest.region,
    node: process.version, compilerVersion: compilerPackage.version, preparedAt: new Date().toISOString(), targets: TARGETS, checksums,
    inputBindingsSha256: digest(JSON.stringify(before)), frozenRestartManifestSha256: before['tools/staging/restart-release-manifest.json'],
    deploymentApproved: false, cloudInventoryVerified: false, sendApproved: false, offlineOnly: true, runtimeDiscoveryVerified: false,
    requiredActivationParameters: ['REGISTRATION_EMAIL_MODE', 'REGISTRATION_EMAIL_ACTIVATED_AT', 'REGISTRATION_EMAIL_ALLOWED_RECIPIENT', 'EMAIL_PUBLIC_ORIGIN', 'GMAIL_SENDER_EMAIL'], optionalActivationParameters: ['GMAIL_REPLY_TO'], secretNames: secrets,
    defaultMode: 'off', workersEnabledByPreparation: false, dependenciesInstalled: false,
    remainingVerification: ['Controlled network-blocked compiled SDK discovery with exact five exports and endpoint/binding checks', 'Fresh approved cloud inventory, identities, private queue/IAM and retained versions', 'Approved scoped activation configuration, named secret versions, Gmail send-only consent and bounded send'],
  }, null, 2));
  const finalHashes = inspectArtifact(destination, expected);
  assertInputBindings(checksums, Object.fromEntries(Object.entries(finalHashes).filter(([name]) => name !== 'receipt.json')));
  validateSource(state());
  assertInputBindings(before, bindings());
  console.log(JSON.stringify({ mode: 'PREPARATION_ONLY', sourceSha: sha, targets: TARGETS.length, fileCount: expected.length, receiptSha256: digest(readFileSync(path.join(destination, 'receipt.json'))), deploymentApproved: false }));
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try { main(); } catch { console.error('EMAIL_ARTIFACT_PREPARATION_STOP; NO_CLOUD_OR_SEND; PRESERVE_PARTIAL_OUTPUT'); process.exitCode = 1; }
}
