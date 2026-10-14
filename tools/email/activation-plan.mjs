// Offline preparation only: no SDK, credentials, OAuth, network or deployment.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, realpathSync, lstatSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const self = fileURLToPath(import.meta.url), root = realpathSync(path.resolve(path.dirname(self), '../..'));
export const PROJECT = 'filmovy-kviz-v2-staging', ORIGIN = 'https://filmovy-kviz-v2-staging.web.app';
export const TARGETS = Object.freeze(['createEventRegistration', 'updateEventRegistration', 'cancelEventRegistration', 'dispatchRegistrationEmail', 'deliverEmailTask']);
export const SECRETS = Object.freeze(['EMAIL_TOKEN_KEYRING', 'GMAIL_OAUTH_CLIENT_ID', 'GMAIL_OAUTH_CLIENT_SECRET', 'GMAIL_OAUTH_REFRESH_TOKEN']);
const need = (condition, code) => { if (!condition) throw new Error(code); };
const plain = value => value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;
const exact = (value, keys) => plain(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
export const hash = value => createHash('sha256').update(value).digest('hex');
// Match the runtime single-mailbox boundary without importing its SDK dependencies.
const mailbox = value => {
  if (typeof value !== 'string') return false;
  const parts = value.split('@');
  return value.length <= 254 && parts.length === 2 && Boolean(parts[0]) && parts[0].length <= 64
    && /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+$/u.test(parts[0])
    && !parts[0].startsWith('.') && !parts[0].endsWith('.') && !parts[0].includes('..')
    && /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}$/u.test(parts[1] ?? '');
};
export function ownerSelection(value) {
  need(exact(value, ['schemaVersion', 'status', 'recordedAt', 'source', 'temporary', 'dedicatedMailboxPlanned', 'requestedSenderEmail', 'verificationRecipientEmail', 'interpretation', 'currentTransport', 'senderAuthorizationVerified', 'providerConnectionConfigured', 'deliveryEnabled', 'containsCredentials']), 'OWNER_SELECTION_FIELDS_INVALID');
  need(value.schemaVersion === 1 && /^DRAFT[A-Z0-9_ -]*$/u.test(value.status) && typeof value.recordedAt === 'string' && Number.isFinite(Date.parse(value.recordedAt)), 'OWNER_SELECTION_STATUS_INVALID');
  need(['temporary', 'dedicatedMailboxPlanned'].every(k => typeof value[k] === 'boolean') && ['source', 'interpretation', 'currentTransport'].every(k => typeof value[k] === 'string' && value[k].length <= 2000), 'OWNER_SELECTION_SHAPE_INVALID');
  need(['senderAuthorizationVerified', 'providerConnectionConfigured', 'deliveryEnabled', 'containsCredentials'].every(k => value[k] === false), 'OWNER_SELECTION_IS_NOT_UNVERIFIED_DRAFT');
  const selected = { senderEmail: value.requestedSenderEmail, recipientEmail: value.verificationRecipientEmail };
  need(mailbox(selected.senderEmail) && mailbox(selected.recipientEmail), 'MAILBOX_SELECTION_INVALID');
  return selected;
}

export function preparePlan(input, selection = null) {
  need(exact(input, ['sourceSha', 'projectId', 'region', 'publicOrigin', 'mode', 'activatedAt']), 'INPUT_FIELDS_INVALID');
  need(/^[a-f0-9]{40}$/u.test(input.sourceSha ?? ''), 'SOURCE_SHA_REQUIRED');
  need(input.projectId === PROJECT && input.region === 'europe-west1' && input.publicOrigin === ORIGIN && input.mode === 'staging', 'FOREIGN_SCOPE');
  need(input.activatedAt === null || typeof input.activatedAt === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(input.activatedAt) && Number.isFinite(Date.parse(input.activatedAt)) && new Date(input.activatedAt).toISOString() === input.activatedAt, 'CUTOFF_INVALID');
  if (selection !== null) need(exact(selection, ['senderEmail', 'recipientEmail']) && mailbox(selection.senderEmail) && mailbox(selection.recipientEmail), 'MAILBOX_SELECTION_INVALID');
  const plan = {
    schemaVersion: 1, mode: 'PREPARATION_ONLY', projectId: PROJECT, region: input.region, publicOrigin: ORIGIN, sourceSha: input.sourceSha,
    sourceWorktreeVerified: false, cloudInventoryVerified: false, deployAuthorized: false, sendAuthorized: false, cloudWrites: 0,
    targets: TARGETS, changes: {
      createEventRegistration: { action: 'update', secrets: ['EMAIL_TOKEN_KEYRING'] },
      updateEventRegistration: { action: 'update', secrets: [] }, cancelEventRegistration: { action: 'update', secrets: [] },
      dispatchRegistrationEmail: { action: 'add', trigger: 'events/{eventId}/emailIntents/{intentId}', registrationTypesOnly: true },
      deliverEmailTask: { action: 'add', privateTaskWorker: true, publicInvokerAllowed: false, secrets: SECRETS },
    },
    parameters: { REGISTRATION_EMAIL_MODE: 'staging', REGISTRATION_EMAIL_ACTIVATED_AT: input.activatedAt,
      REGISTRATION_EMAIL_ALLOWED_RECIPIENT: selection === null ? 'REQUIRED_UNSET' : 'PRIVATE_SELECTION_ONLY',
      GMAIL_SENDER_EMAIL: selection === null ? 'REQUIRED_UNSET' : 'PRIVATE_SELECTION_ONLY', GMAIL_REPLY_TO: 'OPTIONAL_UNSET', EMAIL_PUBLIC_ORIGIN: ORIGIN },
    secretNames: SECRETS, mailboxSelectionPresent: selection !== null,
    blockers: [
      ...(selection === null ? ['OWNER_MAILBOX_SELECTION_UNSET'] : []), ...(input.activatedAt === null ? ['ACTIVATION_CUTOFF_UNSET'] : []),
      'HUMAN_OAUTH_SEND_ONLY_NOT_VERIFIED', 'SECRET_VERSIONS_AND_KEYRING_RETENTION_NOT_VERIFIED',
      'CURRENT_CLOUD_INVENTORY_AND_PRIVATE_QUEUE_IAM_NOT_VERIFIED', 'EXACT_SOURCE_ARTIFACT_AND_RUNTIME_DISCOVERY_NOT_VERIFIED',
      'DEPLOYMENT_AND_ONE_RECIPIENT_SEND_APPROVAL_NOT_VERIFIED',
    ],
    exclusions: ['team-email endpoints/intents', 'historical intent backfill', 'inbox reads', 'OAuth server', 'production/V1', 'Rules/Hosting/Storage/IAM/API mutation by this tool'],
    evidenceRequired: ['Human gmail.send-only OAuth consent; sender/recipient selection is not verified mailbox ownership.',
      'Retain old keyring keys for existing envelopes; never record key/token values in this plan.',
      'Read-only cloud inventory must establish create/update classification and exact queue/service identities before deployment.',
      'Default off binds no email secrets/parameters; staging opt-in must reject foreign projects, recipients and pre-cutoff intents.',
      'Offline fake-provider/registration regressions, packaged endpoint discovery, compatible rollout and stop plan.',
      'Separate approval for exact provisioning/deployment and a bounded synthetic registration send; Gmail accepted is not delivered/exactly-once.'],
  };
  return { publicPlan: plan, privateSelection: selection };
}

// All explicit input/output paths stay in ignored local data; no discovery of personal files.
export function localPath(candidate, { directory = false } = {}) {
  const absolute = path.resolve(candidate), local = path.join(root, '.local-data');
  need(absolute.startsWith(local + path.sep), 'PATH_OUTSIDE_IGNORED_LOCAL_DATA');
  for (const part of path.relative(root, absolute).split(path.sep)) need(!/(?:^\.env|credential|service.?account|token|secret|\.pem$|\.key$)/iu.test(part), 'CREDENTIAL_PATH_REFUSED');
  need(directory || path.extname(absolute) === '.json', 'JSON_INPUT_REQUIRED');
  need(existsSync(absolute) && realpathSync(absolute) === absolute && !lstatSync(absolute).isSymbolicLink(), 'MISSING_OR_LINKED_PATH');
  need(directory ? lstatSync(absolute).isDirectory() : lstatSync(absolute).isFile(), 'PATH_TYPE_INVALID');
  return absolute;
}
export function savePlans(outputDirectory, prepared, bindings = {}) {
  const directory = localPath(outputDirectory, { directory: true });
  const publicFile = path.join(directory, 'activation-plan.json'), privateFile = path.join(directory, 'activation-plan-private.json');
  need(!existsSync(publicFile) && !existsSync(privateFile), 'OUTPUT_ALREADY_EXISTS');
  const publicPlan = { ...prepared.publicPlan, inputBindings: bindings };
  if (prepared.privateSelection !== null) {
    const privateBytes = JSON.stringify({ mode: 'PREPARATION_ONLY_PRIVATE_SELECTION', sourceSha: publicPlan.sourceSha, projectId: PROJECT, ...prepared.privateSelection }, null, 2);
    writeFileSync(privateFile, privateBytes, { flag: 'wx', mode: 0o600 });
    publicPlan.privateSelectionFileSha256 = hash(privateBytes);
  }
  writeFileSync(publicFile, JSON.stringify(publicPlan, null, 2), { flag: 'wx', mode: 0o600 });
  return { mode: 'PREPARATION_ONLY', planSha256: hash(readFileSync(publicFile)), blockerCount: publicPlan.blockers.length, cloudWrites: 0, deployAuthorized: false, sendAuthorized: false };
}
function main() {
  need(process.versions.node.split('.')[0] === '22', 'NODE22_REQUIRED');
  const flags = {};
  for (let i = 2; i < process.argv.length; i += 2) { const key = process.argv[i], value = process.argv[i + 1]; need(['--input', '--out', '--owner-selection'].includes(key) && !Object.hasOwn(flags, key) && typeof value === 'string' && !value.startsWith('--'), 'ARGUMENTS_INVALID'); flags[key] = value; }
  need(flags['--input'] && flags['--out'], 'INPUT_AND_OUTPUT_REQUIRED');
  const inputPath = localPath(flags['--input']), out = localPath(flags['--out'], { directory: true });
  const selectionPath = flags['--owner-selection'] ? localPath(flags['--owner-selection']) : null;
  const inputBytes = readFileSync(inputPath), selectionBytes = selectionPath === null ? null : readFileSync(selectionPath);
  const input = JSON.parse(inputBytes);
  need(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() === input.sourceSha, 'HEAD_SHA_MISMATCH');
  const manifest = readFileSync(path.join(root, 'tools/staging/restart-release-manifest.json'));
  const prepared = preparePlan(input, selectionBytes === null ? null : ownerSelection(JSON.parse(selectionBytes)));
  const result = savePlans(out, prepared, { inputSha256: hash(inputBytes), ownerSelectionInputSha256: selectionBytes === null ? null : hash(selectionBytes), plannerSha256: hash(readFileSync(self)), frozenRestartManifestSha256: hash(manifest) });
  console.log(JSON.stringify(result));
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try { main(); } catch { console.error('EMAIL_ACTIVATION_PREPARATION_STOP; NO_CLOUD_OR_SEND'); process.exitCode = 1; }
}
