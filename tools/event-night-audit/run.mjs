import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { access, mkdir, readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';

import { assertAuditMode, auditBaseUrl, auditPaths, auditPorts, auditProjectId } from './config.mjs';

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function run(label, command, args, environment) {
  console.log(`[audit] ${label}`);
  const result = spawnSync(command, args, { cwd: process.cwd(), env: environment, stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`${label} failed with exit code ${result.status ?? 'unknown'}.`);
}

function isListening(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    const finish = (value) => { socket.destroy(); resolve(value); };
    socket.setTimeout(300);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

async function occupiedAuditPorts() {
  const entries = Object.entries(auditPorts);
  const states = await Promise.all(entries.map(async ([name, port]) => ({ name, port, listening: await isListening(port) })));
  return states.filter((state) => state.listening);
}

async function waitForPortRelease() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const occupied = await occupiedAuditPorts();
    if (occupied.length === 0) return [];
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return occupiedAuditPorts();
}

async function resolvePrimarySource() {
  const commonOutput = execFileSync('git', ['rev-parse', '--git-common-dir'], { encoding: 'utf8' }).trim();
  const commonDirectory = path.resolve(process.cwd(), commonOutput);
  const primaryRoot = path.dirname(commonDirectory);
  const source = path.join(primaryRoot, '.local-data/v1-export/library.json');
  const [realSource, realAllowedRoot] = await Promise.all([
    realpath(source),
    realpath(path.join(primaryRoot, '.local-data/v1-export')),
  ]);
  if (path.relative(realAllowedRoot, realSource) !== 'library.json') {
    throw new Error('Resolved source is not the exact primary .local-data/v1-export/library.json file.');
  }
  return { primaryRoot, source: realSource };
}

async function resolveJava21(primaryRoot) {
  const root = path.join(primaryRoot, '.tools/jdk21');
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const home = path.join(root, entry.name);
    const executable = path.join(home, 'bin/java.exe');
    try {
      await access(executable);
      const version = spawnSync(executable, ['-version'], { encoding: 'utf8' });
      if (`${version.stdout ?? ''}${version.stderr ?? ''}`.includes('21.')) return home;
    } catch {
      // Keep looking for the pinned local JDK 21 runtime.
    }
  }
  throw new Error('Pinned local JDK 21 runtime was not found.');
}

async function resolvePlaywrightExecutable(primaryRoot) {
  const root = path.join(primaryRoot, '.tools/playwright');
  const directories = await readdir(root, { withFileTypes: true });
  const candidates = directories.filter((entry) => entry.isDirectory()).flatMap((entry) => [
    path.join(root, entry.name, 'chrome-headless-shell-win64/chrome-headless-shell.exe'),
    path.join(root, entry.name, 'chrome-win64/chrome.exe'),
  ]);
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Continue to the next locally provisioned Playwright browser.
    }
  }
  throw new Error('Locally provisioned Playwright Chromium executable was not found.');
}

async function main() {
  const mode = assertAuditMode(process.argv[2] ?? 'all');
  if (!process.env.npm_execpath) throw new Error('Use pnpm audit:event-night:* so the pinned pnpm runtime is retained.');
  const initialPorts = await occupiedAuditPorts();
  if (initialPorts.length > 0) {
    throw new Error(`Isolated audit ports are already occupied: ${initialPorts.map((item) => item.port).join(', ')}.`);
  }
  const { primaryRoot, source } = await resolvePrimarySource();
  if (Number(process.versions.node.split('.')[0]) !== 22) throw new Error('Event-night audit requires Node 22.');
  const javaHome = await resolveJava21(primaryRoot);
  const playwrightExecutable = await resolvePlaywrightExecutable(primaryRoot);
  const sourceBefore = await readFile(source);
  const paths = auditPaths();
  await mkdir(paths.localRoot, { recursive: true });
  const environment = {
    ...process.env,
    PATH: `${path.join(javaHome, 'bin')}${path.delimiter}${process.env.PATH ?? ''}`,
    JAVA_HOME: javaHome,
    PLAYWRIGHT_EXECUTABLE_PATH: playwrightExecutable,
    GCLOUD_PROJECT: auditProjectId,
    GOOGLE_CLOUD_PROJECT: auditProjectId,
    FIREBASE_PROJECT_ID: auditProjectId,
    FIREBASE_AUTH_EMULATOR_HOST: `127.0.0.1:${auditPorts.auth}`,
    FIRESTORE_EMULATOR_HOST: `127.0.0.1:${auditPorts.firestore}`,
    FUNCTIONS_EMULATOR_HOST: `127.0.0.1:${auditPorts.functions}`,
    FIREBASE_STORAGE_EMULATOR_HOST: `127.0.0.1:${auditPorts.storage}`,
    EVENT_NIGHT_AUDIT_BASE_URL: auditBaseUrl,
    EVENT_NIGHT_AUDIT_MODE: mode,
    EVENT_NIGHT_AUDIT_SOURCE: source,
    EVENT_NIGHT_AUDIT_PRIMARY_ROOT: primaryRoot,
    VITE_FIREBASE_API_KEY: 'demo-audit-api-key',
    VITE_FIREBASE_AUTH_DOMAIN: `${auditProjectId}.firebaseapp.com`,
    VITE_FIREBASE_PROJECT_ID: auditProjectId,
    VITE_FIREBASE_STORAGE_BUCKET: `${auditProjectId}.appspot.com`,
    VITE_FIREBASE_MESSAGING_SENDER_ID: '000000000000',
    VITE_FIREBASE_APP_ID: '1:000000000000:web:background-audit',
    VITE_FIREBASE_USE_EMULATORS: 'true',
    VITE_FIREBASE_AUTH_EMULATOR_PORT: String(auditPorts.auth),
    VITE_FIRESTORE_EMULATOR_PORT: String(auditPorts.firestore),
    VITE_FUNCTIONS_EMULATOR_PORT: String(auditPorts.functions),
    VITE_FIREBASE_STORAGE_EMULATOR_PORT: String(auditPorts.storage),
  };
  delete environment.GOOGLE_APPLICATION_CREDENTIALS;
  delete environment.VITE_FIREBASE_ALLOW_NON_DEMO_PROJECT;
  let runError;
  try {
    run('production build for isolated demo ports', process.execPath, [process.env.npm_execpath, '-r', 'build'], environment);
    const firebaseCli = path.resolve('node_modules/firebase-tools/lib/bin/firebase.js');
    run('isolated Firebase Emulator Suite audit', process.execPath, [
      firebaseCli,
      'emulators:exec',
      '--only', 'auth,firestore,functions,hosting,storage',
      '--project', auditProjectId,
      '--config', 'firebase.audit.json',
      `${process.execPath} tools/event-night-audit/run-inside.mjs ${mode}`,
    ], environment);
  } catch (error) {
    runError = error;
  }
  const sourceAfter = await readFile(source);
  const integrity = {
    sourcePath: source,
    bytes: (await stat(source)).size,
    beforeHash: sha256(sourceBefore),
    afterHash: sha256(sourceAfter),
    match: sha256(sourceBefore) === sha256(sourceAfter),
  };
  await writeFile(paths.sourceIntegrity, `${JSON.stringify(integrity, null, 2)}\n`, 'utf8');
  const remainingPorts = await waitForPortRelease();
  console.log(JSON.stringify({
    status: runError === undefined && integrity.match && remainingPorts.length === 0 ? 'PASS' : 'FAIL',
    mode,
    sourceHashMatch: integrity.match,
    remainingAuditPorts: remainingPorts.map((item) => item.port),
  }));
  if (!integrity.match) throw new Error('The read-only source hash changed during the audit.');
  if (remainingPorts.length > 0) throw new Error('Audit-owned emulator ports were not released cleanly.');
  if (runError !== undefined) throw runError;
}

await main();
