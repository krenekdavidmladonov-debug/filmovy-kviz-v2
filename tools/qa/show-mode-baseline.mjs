import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
assert.equal(Number(process.versions.node.split('.')[0]), 22, 'Baseline build/preview requires the repository Node 22 runtime.');
const target = resolve(root, '.local-data/show-mode-baseline');
assert(target.startsWith(root + sep + '.local-data' + sep));
const sourceSha = '9404e1c5e96b085af875c0eefb641247a6388c0e';
const source = resolve(target, 'source'), hosting = resolve(target, 'hosting');
const archive = resolve(target, 'source.tar'), receiptPath = resolve(target, 'source.json');
if (process.env.GCLOUD_PROJECT) assert.match(process.env.GCLOUD_PROJECT, /^demo-/u);
if (process.env.VITE_FIREBASE_PROJECT_ID) assert.match(process.env.VITE_FIREBASE_PROJECT_ID, /^demo-/u);
mkdirSync(source, { recursive: true }); mkdirSync(hosting, { recursive: true });
const execute = (command, args) => {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${command} failed`);
};
if (existsSync(receiptPath)) {
  assert.equal(JSON.parse(readFileSync(receiptPath, 'utf8')).sourceSha, sourceSha);
} else {
  execute('git', ['archive', '--format=tar', '--output=' + archive, sourceSha, 'apps/web', 'packages/quiz-domain']);
  execute('tar', ['-xf', archive, '-C', source]);
  writeFileSync(receiptPath, JSON.stringify({ sourceSha, method: 'git archive of tracked apps/web and packages/quiz-domain; no checkout mutation; no installs', source }, null, 2));
}
Object.assign(process.env, {
  VITE_FIREBASE_API_KEY: 'demo-api-key', VITE_FIREBASE_AUTH_DOMAIN: 'demo-filmovy-kviz-v2.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: 'demo-filmovy-kviz-v2', VITE_FIREBASE_USE_EMULATORS: 'true',
  VITE_FIREBASE_STORAGE_BUCKET: 'demo-filmovy-kviz-v2.appspot.com', VITE_FIREBASE_MESSAGING_SENDER_ID: '000000000000',
  VITE_FIREBASE_APP_ID: '1:000000000000:web:demo', VITE_ENABLE_TEAM_EMAIL: 'false',
});
const vitePath = resolve(root, 'apps/web/node_modules/vite/dist/node/index.js');
const reactPath = resolve(root, 'apps/web/node_modules/@vitejs/plugin-react/dist/index.js');
const { build, preview } = await import(pathToFileURL(vitePath).href);
const { default: react } = await import(pathToFileURL(reactPath).href);
const config = {
  configFile: false, envDir: false, root: resolve(source, 'apps/web'), mode: 'production',
  plugins: [react()],
  resolve: { alias: [
    { find: '@filmovy-kviz/quiz-domain', replacement: resolve(source, 'packages/quiz-domain/src/index.ts') },
    { find: 'qrcode', replacement: resolve(root, 'apps/web/node_modules/qrcode/lib/browser.js') },
  ] },
  build: { outDir: hosting, emptyOutDir: false },
  preview: { host: '127.0.0.1', port: 5209, strictPort: true },
};
await build(config);
writeFileSync(resolve(target, 'build.json'), JSON.stringify({
  sourceSha, frontendSource: source, quizDomainAlias: config.resolve.alias[0].replacement,
  output: hosting, node: process.version, nodeExecutable: process.execPath,
  method: 'Archived baseline frontend and archived baseline quiz-domain; current local Vite/React build tools and installed dependency versions; demo-only production Vite build.',
  backendScope: 'Comparison uses the same current local Functions/emulators for both web bundles. This is a frontend before/after comparison, not a historical backend reproduction.',
}, null, 2));
if (process.argv.includes('--serve')) {
  const server = await preview(config);
  server.printUrls();
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.httpServer.close(() => { process.exitCode = 0; }));
}
