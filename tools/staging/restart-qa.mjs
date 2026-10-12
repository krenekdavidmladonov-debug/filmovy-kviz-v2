// LOCAL PREPARATION TOOL. Importing this file is not a grant to provision cloud.
// Apply requires separate explicit approval of QA writes AND whole-QA retention.
// This tool does not sign in QA users, seed content, update scopes or clean up.
import { randomBytes } from 'node:crypto';
import { readFileSync, openSync, writeFileSync, fsyncSync, closeSync, realpathSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { PROJECT, RELEASE_SHA, RECEIPT_SHA256, QA_RUN_ID, USERS, hash, demand, qaPlan, validateCredentials, executeQa } from './restart-qa-core.mjs';
import { connectQaStore } from './restart-qa-store.mjs';

const root = realpathSync(fileURLToPath(new URL('../../', import.meta.url)));
const samePath = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
function ignored(file, present = true) {
  const resolved = path.resolve(file), relative = path.relative(root, resolved);
  demand(relative.startsWith(`.local-data${path.sep}`) && !relative.split(path.sep).includes('..'), 'IGNORED_LOCAL_DATA_PATH_REQUIRED');
  demand(samePath(realpathSync(path.dirname(resolved)), path.dirname(resolved)), 'LINKED_PATH_DENIED');
  if (present) demand(samePath(realpathSync(resolved), resolved), 'LINKED_FILE_DENIED');
  execFileSync('git', ['check-ignore', '--', resolved], { cwd: root, stdio: 'pipe' });
  return resolved;
}
function parseArgs(args) {
  const options = {};
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    demand(['--help', '--approval', '--credentials', '--out', '--prepare-credentials', '--apply', '--reconcile', '--confirm-plan-sha256'].includes(key)
      && !Object.hasOwn(options, key), 'UNKNOWN_OR_DUPLICATE_OPTION');
    options[key] = ['--help', '--prepare-credentials', '--apply', '--reconcile'].includes(key) ? true : args[++i];
    demand(options[key] && !String(options[key]).startsWith('--'), 'MISSING_OPTION_VALUE');
  }
  return options;
}
function environment() {
  demand(process.versions.node.split('.')[0] === '22', 'NODE_22_REQUIRED');
  for (const [key, value] of Object.entries(process.env)) {
    if (!value) continue;
    demand(!/EMULATOR|^(?:FIREBASE_CONFIG|FIREBASE_TOKEN|GOOGLE_APPLICATION_CREDENTIALS|GOOGLE_CLOUD_QUOTA_PROJECT|NODE_OPTIONS|FIREBASE_CLI_EXPERIMENTS)$|(?:FIREBASE|CLOUD_RUN|EVENTARC|FIRESTORE|PUBSUB|STORAGE|IAM|COMPUTE).*_(?:URL|ORIGIN)$/u.test(key), 'TARGET_OR_CREDENTIAL_OVERRIDE_DENIED');
    if (['GCLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT', 'FIREBASE_PROJECT_ID'].includes(key)) demand(value === PROJECT, 'FOREIGN_PROJECT_ENVIRONMENT');
  }
}
async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options['--help']) {
    demand(Object.keys(options).length === 1, 'HELP_ACCEPTS_NO_OTHER_OPTIONS');
    console.log(`Local preparation only; no authority to provision cloud. No sign-in, content writes, scope changes, cleanup or unpause.
Create an operator-protected ignored directory first. File mode alone does not prove Windows ACL isolation.
Offline: node tools/staging/restart-qa.mjs --prepare-credentials --credentials NEW-ignored.json
Read-only dry-run (uses existing explicit CLI OAuth account): --approval reviewed-ignored.json --credentials ignored.json --out .local-data/restart-qa/${QA_RUN_ID}/provisioning.jsonl
Separately approved apply adds: --apply --confirm-plan-sha256 EXACT_DRY_RUN_HASH
Read-only recovery adds: --reconcile (same approval, credentials and original receipt; never resumes writes).
Approval requires exact projectId, releaseSha, artifactReceiptSha256, qaRunId, expectedRevision, expectedUpdateTime, operatorEmail, approvedBy, approvalReference, credentialsSha256,
qaLifecycleDecision: retention-approved and qaLifecycleApprovalReference for explicit whole-QA retention. This tool implements no cleanup or post-run disablement.
After any write intent, preserve the receipt, .apply-once fence and private attachment. No retry/reset/removal is provided. Auth and Firestore are not atomic.`);
    return;
  }
  if (options['--prepare-credentials']) {
    demand(Object.keys(options).length === 2 && options['--credentials'], 'OFFLINE_PREPARATION_REQUIRES_ONLY_NEW_CREDENTIAL_PATH');
    const output = ignored(options['--credentials'], false);
    const credentials = { mode: 'PRIVATE_RESTART_QA_CREDENTIALS', projectId: PROJECT, releaseSha: RELEASE_SHA, qaRunId: QA_RUN_ID,
      users: Object.fromEntries(USERS.map(({ slot, uid, email }) => [slot, { uid, email, password: randomBytes(32).toString('base64url') + '!aA9' }])) };
    validateCredentials(credentials);
    const bytes = JSON.stringify(credentials, null, 2) + '\n', fd = openSync(output, 'wx', 0o600);
    try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
    console.log(JSON.stringify({ mode: 'OFFLINE_CREDENTIALS_PREPARED_NOT_AUTHORITY', credentialsSha256: hash(bytes),
      instruction: 'Keep this ignored attachment in an operator-protected directory; file mode alone does not prove Windows ACL isolation. Separately approve exact QA writes and whole-QA retention.' }));
    return;
  }
  demand(options['--approval'] && options['--credentials'] && options['--out'], 'USAGE_APPROVAL_CREDENTIALS_OUT_REQUIRED');
  demand(!options['--apply'] || !options['--reconcile'], 'APPLY_AND_RECONCILE_ARE_EXCLUSIVE');
  demand(Boolean(options['--apply']) === Boolean(options['--confirm-plan-sha256']), 'APPLY_AND_EXACT_PLAN_HASH_REQUIRED_TOGETHER');
  environment();
  const approvalBytes = readFileSync(ignored(options['--approval'])), approval = JSON.parse(approvalBytes);
  const plan = qaPlan(approval);
  const credentialBytes = readFileSync(ignored(options['--credentials']));
  demand(hash(credentialBytes) === approval.credentialsSha256, 'PRIVATE_ATTACHMENT_CHANGED');
  const credentials = JSON.parse(credentialBytes); validateCredentials(credentials);
  const artifactReceipt = readFileSync(ignored(path.join(root, '.local-data/restart-release', RELEASE_SHA, 'receipt.json')));
  demand(hash(artifactReceipt) === RECEIPT_SHA256, 'FROZEN_ARTIFACT_RECEIPT_CHANGED');
  const receiptValue = JSON.parse(artifactReceipt);
  demand(receiptValue.releaseSha === RELEASE_SHA && receiptValue.projectId === PROJECT, 'FOREIGN_ARTIFACT_RECEIPT');
  const expectedOutput = path.join(root, '.local-data/restart-qa', QA_RUN_ID, 'provisioning.jsonl');
  const output = ignored(options['--out'], existsSync(options['--out']));
  demand(samePath(output, expectedOutput), 'FIXED_RUN_RECEIPT_PATH_REQUIRED');
  demand(!samePath(output, path.resolve(options['--credentials'])) && !samePath(output, path.resolve(options['--approval'])), 'INPUT_OUTPUT_PATH_COLLISION');
  const history = existsSync(output) ? readFileSync(output, 'utf8').split(/\r?\n/u).filter(Boolean).map(line => JSON.parse(line)) : [];
  demand(!options['--reconcile'] || history.length > 0, 'ORIGINAL_RECEIPT_REQUIRED');
  const fd = openSync(output, existsSync(output) ? 'a' : 'wx', 0o600);
  let attempted = false;
  const record = value => {
    if (value.mode === 'AUTH_CREATE_PENDING' && !attempted) {
      // Create-only fence survives crashes, concurrent invocations and accidental
      // ledger replacement. It is never reset or removed by this tool.
      const fence = openSync(`${output}.apply-once`, 'wx', 0o600);
      try { writeFileSync(fence, `${plan.planSha256}\n`); fsyncSync(fence); } finally { closeSync(fence); }
    }
    if (['AUTH_CREATE_PENDING', 'FIRESTORE_COMMIT_PENDING'].includes(value.mode)) attempted = true;
    writeFileSync(fd, JSON.stringify({ at: new Date().toISOString(), projectId: PROJECT, releaseSha: RELEASE_SHA, planSha256: plan.planSha256, ...value }) + '\n'); fsyncSync(fd);
  };
  try {
    if (options['--apply']) demand(options['--confirm-plan-sha256'] === plan.planSha256, 'REVIEWED_PLAN_MISMATCH');
    // Check receipt binding before appending or authenticating; changed approvals
    // cannot repurpose the fixed run ledger.
    demand(history.every(row => row.projectId === PROJECT && row.releaseSha === RELEASE_SHA && row.planSha256 === plan.planSha256), 'FOREIGN_OR_CHANGED_RECEIPT');
    record({ mode: 'STARTED', apply: Boolean(options['--apply']), reconcile: Boolean(options['--reconcile']), approvalSha256: hash(approvalBytes) });
    const require = createRequire(import.meta.url);
    const store = await connectQaStore(plan, name => require(name === 'package' ? 'firebase-tools/package.json' : `firebase-tools/lib/${name}`));
    const result = await executeQa({ plan, credentials, store, apply: Boolean(options['--apply']), reconcile: Boolean(options['--reconcile']),
      confirmPlanSha256: options['--confirm-plan-sha256'], history, record });
    record(result);
    // The report/plan never contains the private credential attachment.
    console.log(JSON.stringify(result));
  } catch {
    const result = { mode: attempted ? 'OUTCOME_UNCONFIRMED' : 'STOPPED_WITHOUT_NEW_WRITE_INTENT', planSha256: plan.planSha256,
      instruction: 'Preserve original receipt and private attachment. Use --reconcile for read-only inspection; no automatic retry, reset, cleanup or unpause. A separate approval is required for any recovery write.' };
    record(result); console.error(JSON.stringify(result)); process.exitCode = 1;
  } finally { closeSync(fd); }
}
main().catch(() => { console.error(JSON.stringify({ mode: 'STOPPED_LOCAL_VALIDATION', instruction: 'Review arguments, ignored paths and explicit approval. Error payloads deliberately omitted.' })); process.exitCode = 1; });
