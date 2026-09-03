import { spawn } from 'node:child_process';

const defaults = Object.freeze({
  FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
  FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
  FUNCTIONS_EMULATOR_HOST: '127.0.0.1:5001',
  GCLOUD_PROJECT: 'demo-filmovy-kviz-v2',
});

const profileKeys = Object.freeze({
  auth: ['FIREBASE_AUTH_EMULATOR_HOST'],
  firestore: ['FIRESTORE_EMULATOR_HOST'],
  full: ['FIREBASE_AUTH_EMULATOR_HOST', 'FIRESTORE_EMULATOR_HOST', 'FUNCTIONS_EMULATOR_HOST'],
});

export function localEmulatorEndpoint(value, label) {
  const match = /^(127\.0\.0\.1|localhost|\[::1\]):([1-9]\d{0,4})$/u.exec(value ?? '');
  const port = Number(match?.[2]);
  if (!match || port > 65_535) {
    throw new Error(`${label} must use localhost with an explicit valid port.`);
  }
  return { host: match[1], port };
}

export function requireDemoProject(environment, label = 'Local emulator command') {
  const projectId = environment.GCLOUD_PROJECT ?? environment.GOOGLE_CLOUD_PROJECT;
  if (!projectId?.startsWith('demo-')) throw new Error(`${label} requires a demo-* project ID.`);
  return projectId;
}

export function requireFullEmulatorEnvironment(environment = process.env, label = 'E2E') {
  const projectId = requireDemoProject(environment, label);
  return {
    projectId,
    authEndpoint: localEmulatorEndpoint(environment.FIREBASE_AUTH_EMULATOR_HOST, `${label} Authentication Emulator`),
    firestoreEndpoint: localEmulatorEndpoint(environment.FIRESTORE_EMULATOR_HOST, `${label} Firestore Emulator`),
    functionsEndpoint: localEmulatorEndpoint(environment.FUNCTIONS_EMULATOR_HOST, `${label} Functions Emulator`),
  };
}

export function environmentWithLocalDefaults(profile, environment = process.env) {
  const requiredKeys = profileKeys[profile];
  if (!requiredKeys) throw new Error(`Unknown local emulator profile: ${profile ?? '<missing>'}.`);
  const resolved = { ...environment };
  for (const key of requiredKeys) {
    if (resolved[key] === undefined) resolved[key] = defaults[key];
  }
  if (resolved.GCLOUD_PROJECT === undefined && resolved.GOOGLE_CLOUD_PROJECT === undefined) {
    resolved.GCLOUD_PROJECT = defaults.GCLOUD_PROJECT;
  }
  requireDemoProject(resolved);
  for (const key of requiredKeys) localEmulatorEndpoint(resolved[key], key);
  return resolved;
}

async function run() {
  const [profile, ...nodeArguments] = process.argv.slice(2);
  if (nodeArguments.length === 0) throw new Error('Missing Node.js script or arguments for local emulator command.');
  const environment = environmentWithLocalDefaults(profile);
  const exit = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, nodeArguments, { env: environment, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
  if (exit.signal) throw new Error(`Local emulator command terminated by signal ${exit.signal}.`);
  process.exitCode = exit.code ?? 1;
}

if (process.argv[1] && new URL(import.meta.url).pathname.toLowerCase().endsWith(
  process.argv[1].replaceAll('\\', '/').toLowerCase(),
)) {
  void run().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
