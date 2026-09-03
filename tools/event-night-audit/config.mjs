import path from 'node:path';

export const auditProjectId = 'demo-filmovy-kviz-v2-background-audit';
export const auditBaseUrl = 'http://127.0.0.1:5200';
export const auditPorts = Object.freeze({
  ui: 4200,
  hub: 4600,
  logging: 4700,
  hosting: 5200,
  functions: 5201,
  firestore: 8280,
  firestoreWebsocket: 9280,
  auth: 9299,
  storage: 9399,
  eventarc: 9499,
  tasks: 9599,
});

export function auditPaths(repoRoot = process.cwd()) {
  const localRoot = path.resolve(repoRoot, '.local-data/background-event-night-audit');
  return {
    localRoot,
    manifest: path.join(localRoot, 'candidate-private.json'),
    beforeState: path.join(localRoot, 'candidate-before.json'),
    visualResults: path.join(localRoot, 'visual-results.json'),
    mediaResults: path.join(localRoot, 'media-results-private.json'),
    networkResults: path.join(localRoot, 'network-results.json'),
    summary: path.join(localRoot, 'sanitized-summary.json'),
    sourceIntegrity: path.join(localRoot, 'source-integrity.json'),
    galleryRoot: path.join(localRoot, 'visual-gallery'),
    screenshots: path.join(localRoot, 'visual-gallery/screenshots'),
    physicalShortlist: path.join(localRoot, 'PHYSICAL_QA_SHORTLIST.md'),
  };
}

function exactHost(value, expected, label) {
  if (value !== expected) throw new Error(`${label} must be exactly ${expected}.`);
}

export function assertAuditEnvironment(environment = process.env) {
  const projectId = environment.GCLOUD_PROJECT ?? environment.GOOGLE_CLOUD_PROJECT;
  if (projectId !== auditProjectId || !projectId.startsWith('demo-')) {
    throw new Error(`Audit requires the exact demo project ${auditProjectId}.`);
  }
  exactHost(environment.FIREBASE_AUTH_EMULATOR_HOST, `127.0.0.1:${auditPorts.auth}`, 'Auth Emulator');
  exactHost(environment.FIRESTORE_EMULATOR_HOST, `127.0.0.1:${auditPorts.firestore}`, 'Firestore Emulator');
  exactHost(environment.FUNCTIONS_EMULATOR_HOST, `127.0.0.1:${auditPorts.functions}`, 'Functions Emulator');
  exactHost(environment.FIREBASE_STORAGE_EMULATOR_HOST, `127.0.0.1:${auditPorts.storage}`, 'Storage Emulator');
  exactHost(environment.EVENT_NIGHT_AUDIT_BASE_URL, auditBaseUrl, 'Audit base URL');
  return { projectId, baseUrl: auditBaseUrl };
}

export function assertAuditMode(value) {
  if (!['visual', 'media', 'network', 'all'].includes(value)) {
    throw new Error('Audit mode must be visual, media, network, or all.');
  }
  return value;
}

export function percentile(values, fraction) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
}
