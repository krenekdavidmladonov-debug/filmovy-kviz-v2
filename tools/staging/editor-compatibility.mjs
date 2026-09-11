import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const baseline = 'edc659ec0137e626c4b7dba63d4eab7211d66cfa';
const root = process.cwd();
const output = path.resolve('.local-data/editor-compatibility');
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' });
const write = (file, value) => { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, value); };
const compile = (file) => ts.transpileModule(git('show', `${baseline}:${file}`), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022, esModuleInterop: true },
}).outputText;
const hashes = {};
for (const name of ['callables', 'model', 'validation', 'repair', 'errors', 'types']) {
  const code = compile(`functions/src/editor/${name}.ts`);
  const hash = createHash('sha256').update(code.trim()).digest('hex');
  hashes[name] = hash;
  write(`functions/lib/editor-baseline/${name}.js`, code);
}
const expected = JSON.parse(readFileSync('tools/staging/editor-baseline-hashes.json', 'utf8'));
assert.deepEqual(hashes, expected, 'Baseline editor differs from the verified deployed source');
const indexFile = 'functions/lib/index.js';
let index = readFileSync(indexFile, 'utf8');
assert(!index.includes('editor-baseline'), 'Rebuild Functions before preparing compatibility');
index = index.replace(/export \{([^}]+)\} from '\.\/editor\/callables.js';/u, (_match, names) => {
  const unchanged = names.split(',').map(n => n.trim()).filter(n => n && !['createQuiz', 'updateQuizSlide'].includes(n));
  return `export { ${unchanged.join(', ')} } from './editor-baseline/callables.js';\nexport { createQuiz, updateQuizSlide } from './editor/callables.js';`;
});
assert(index.includes('editor-baseline'));
write(indexFile, index);

// Compile the exact old client independently; its domain mapping must also stay old.
const files = git('ls-tree', '-r', '--name-only', baseline, '--', 'apps/web').trim().split('\n');
for (const file of files) write(path.join(output, file), execFileSync('git', ['show', `${baseline}:${file}`]));
const domainFiles = git('ls-tree', '-r', '--name-only', baseline, '--', 'packages/quiz-domain/src').trim().split('\n');
for (const file of domainFiles) write(path.join(output, 'domain', path.basename(file).replace(/\.ts$/u, '.js')), compile(file));
Object.assign(process.env, {
  VITE_APP_ENV: 'local', VITE_FIREBASE_PROJECT_ID: 'demo-filmovy-kviz-v2', VITE_FIREBASE_USE_EMULATORS: 'true',
  VITE_FIREBASE_API_KEY: 'demo-api-key', VITE_FIREBASE_AUTH_DOMAIN: 'demo-filmovy-kviz-v2.firebaseapp.com',
  VITE_FIREBASE_STORAGE_BUCKET: 'demo-filmovy-kviz-v2.appspot.com', VITE_FIREBASE_MESSAGING_SENDER_ID: '000000000000',
  VITE_FIREBASE_APP_ID: '1:000000000000:web:demo',
});
const webRequire = createRequire(path.join(root, 'apps/web/package.json'));
const { build } = await import(pathToFileURL(webRequire.resolve('vite')).href);
const { default: react } = await import(pathToFileURL(webRequire.resolve('@vitejs/plugin-react')).href);
await build({ root: path.join(output, 'apps/web'), configFile: false, plugins: [react()],
  resolve: { alias: { '@filmovy-kviz/quiz-domain': path.join(output, 'domain/index.js'), qrcode: webRequire.resolve('qrcode/lib/browser.js') } },
  build: { outDir: path.join(output, 'baseline-dist') },
});
write(path.join(output, 'manifest.json'), JSON.stringify({ baseline, editorHashes: hashes, mode: 'EMULATOR',
  backend: 'Only createQuiz/updateQuizSlide are candidate code; all other editor exports are verified deployed code',
  frontend: 'Exact baseline Git sources and baseline domain, demo emulator configuration',
}, null, 2));
