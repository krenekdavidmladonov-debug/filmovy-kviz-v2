import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { assertStagingEnvironment, STAGING_PROJECT } from './guard.mjs';

export function validateInputs({ sha, head, branch, status, node, sdk, bucket }) {
  assert.match(sha ?? '', /^[a-f0-9]{40}$/u, 'An exact approved full SHA is required');
  assert.equal(head, sha, 'HEAD differs from approved SHA');
  assert.equal(branch, 'codex/restart-integration');
  assert.equal(status, '', 'Tracked and untracked tree must be clean');
  assert.equal(node.split('.')[0], '22', 'Node 22 is required');
  assert.equal(sdk.projectId, STAGING_PROJECT);
  assert.deepEqual(Object.keys(sdk).sort(), ['apiKey', 'appId', 'authDomain', 'messagingSenderId', 'projectId', 'storageBucket'].sort(), 'Only explicit public SDK configuration is accepted');
  for (const value of Object.values(sdk)) assert.equal(typeof value, 'string');
  assert.equal(bucket.projectId, STAGING_PROJECT);
  assert.deepEqual(Object.keys(bucket).sort(), ['projectId', 'name', 'location', 'verified', 'verifiedAt', 'evidence'].sort(), 'Only explicit bucket metadata evidence is accepted');
  assert.equal(bucket.name, sdk.storageBucket);
  assert.equal(bucket.verified, true, 'Bucket metadata must be verified by approved read-only preflight');
  assert.match(bucket.location ?? '', /^[a-z]+[a-z0-9-]*$/iu);
  assert(Number.isFinite(Date.parse(bucket.verifiedAt)), 'Bucket verification timestamp required');
  assert.equal(typeof bucket.evidence, 'string');
  assert(bucket.evidence.trim().length > 0, 'Bucket verification provenance required');
  const env = { VITE_APP_ENV: 'staging', VITE_FIREBASE_API_KEY: sdk.apiKey,
    VITE_FIREBASE_AUTH_DOMAIN: sdk.authDomain, VITE_FIREBASE_PROJECT_ID: sdk.projectId,
    VITE_FIREBASE_STORAGE_BUCKET: sdk.storageBucket, VITE_FIREBASE_MESSAGING_SENDER_ID: sdk.messagingSenderId,
    VITE_FIREBASE_APP_ID: sdk.appId, VITE_FIREBASE_USE_EMULATORS: 'false',
    VITE_FIREBASE_ALLOW_NON_DEMO_PROJECT: 'true', VITE_ENABLE_TEAM_EMAIL: 'false' };
  assertStagingEnvironment(env);
  return env;
}

export function targetedEntry(source, functions) {
  assert.equal(functions.length, 70);
  assert.equal(new Set(functions).size, 70);
  const found = [], lines = [];
  for (const match of source.matchAll(/export\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/gu)) {
    const names = match[1].split(',').map(name => name.trim()).filter(Boolean);
    assert(names.every(name => /^[A-Za-z]\w*$/u.test(name)), 'Unsupported export syntax');
    const selected = names.filter(name => functions.includes(name));
    if (selected.length) {
      assert.match(match[2], /^\.\/[a-z0-9/-]+\.js$/u);
      lines.push(`export { ${selected.join(', ')} } from '${match[2]}';`);
      found.push(...selected);
    }
  }
  assert.deepEqual(found.sort(), [...functions].sort(), 'Exact release exports must exist once in source');
  return lines.join('\n') + '\n';
}

export function runtimeClosure(entry, read, packages = null) {
  const files = new Map([['index.js', entry]]), pending = ['index.js'];
  while (pending.length) {
    const name = pending.pop(), text = files.get(name);
    assert(!/\bimport\s*\((?!\s*['"])/u.test(text), 'Nonliteral dynamic imports require manual inventory');
    for (const match of text.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)['"]([^'"]+)['"]/gu)) {
      const dependency = match[1];
      if (!dependency.startsWith('.')) {
        const packageName = dependency.startsWith('@') ? dependency.split('/').slice(0, 2).join('/') : dependency.split('/')[0];
        assert(dependency.startsWith('node:') || packages === null || packages.includes(packageName), 'Uninventoried external runtime dependency');
        continue;
      }
      const relative = path.posix.normalize(path.posix.join(path.posix.dirname(name), dependency));
      assert(!relative.startsWith('../') && !relative.startsWith('/') && relative.endsWith('.js'), 'Runtime import escapes packaged JS');
      assert(!relative.split('/').includes('dev') && !['index.js', 'email/worker.js', 'email/team-callables.js'].includes(relative), 'Forbidden runtime entrypoint dependency');
      if (!files.has(relative)) { files.set(relative, read(relative)); pending.push(relative); }
    }
  }
  return files;
}

export function artifactPackage(pkg, lock, manifest) {
  assert.deepEqual(pkg.dependencies, manifest.runtime.packages, 'Runtime inventory differs from source package');
  assert.equal(pkg.engines.node, '22');
  const result = structuredClone(pkg);
  delete result.scripts;
  result.dependencies['@filmovy-kviz/quiz-domain'] = 'file:vendor/quiz-domain';
  assert.deepEqual(lock.packages[''].dependencies, result.dependencies, 'Package lock dependency drift');
  assert.deepEqual(lock.packages[''].engines, result.engines);
  assert.equal(lock.packages[''].name, result.name);
  assert.equal(lock.packages[''].version, result.version);
  assert.equal(lock.packages['node_modules/@filmovy-kviz/quiz-domain'].resolved, 'vendor/quiz-domain');
  return result;
}

export function assertArtifactPath(name) {
  assert(!name.includes('\\') && !name.split('/').includes('..') && !name.startsWith('/'));
  assert(!/(^|\/)(?:\.env[^/]*|node_modules|dev|tests?|fixtures?|[^/]*service[-_]?account[^/]*|credentials?\.json)(\/|$)|\.(?:pem|key|p12|map)$/iu.test(name), 'Forbidden artifact file');
  assert(/^(?:hosting\/|functions\/(?:lib\/.*\.js$|vendor\/quiz-domain\/(?:lib\/.*\.(?:js|d\.ts)$|package\.json$)|package(?:-lock)?\.json$)|firestore\.rules$|storage\.rules$|firestore\.indexes\.json$|firebase\.restart\.json$|release-inventory\.json$|receipt\.json$)/u.test(name), 'Artifact scope violation');
}

export function restartViteConfig(root, domain, hosting) {
  const url = relative => pathToFileURL(path.join(root, relative)).href;
  // The pnpm workspace junction can point at stale ignored domain/lib output.
  // Exact matching also prevents silently resolving new domain subpaths there.
  return `import { defineConfig } from ${JSON.stringify(url('apps/web/node_modules/vite/dist/node/index.js'))};\nimport react from ${JSON.stringify(url('apps/web/node_modules/@vitejs/plugin-react/dist/index.js'))};\nexport default defineConfig({root:${JSON.stringify(path.join(root, 'apps/web'))},envDir:false,plugins:[react()],resolve:{alias:[{find:/^@filmovy-kviz\\/quiz-domain$/,replacement:${JSON.stringify(path.join(domain, 'index.js'))}}]},build:{outDir:${JSON.stringify(hosting)},sourcemap:false}});\n`;
}

export function assertStagingBanner(frontend) {
  // Check the rendered label in JS, rather than a CSS class or an old English marker.
  assert(frontend.some(file => file.name.endsWith('.js') && /["']span["']\s*,\s*\{\s*className\s*:\s*["']admin-environment-label["']\s*,\s*children\s*:\s*["']Testovací verze["']/u.test(file.text)), 'Current staging banner required');
}
