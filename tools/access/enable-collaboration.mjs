import assert from 'node:assert/strict';
import { readFileSync, openSync, writeSync, fsyncSync, closeSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { enablePlan, assertInvitationPreflight, summarizeInvitations, executeEnable } from './enable-collaboration-core.mjs';
import { connectPauseStore } from './pause-collaboration-store.mjs';

const project = 'filmovy-kviz-v2-staging';
const root = realpathSync(fileURLToPath(new URL('../../', import.meta.url)));
export async function readMaskedInvitations(client, clock = Date.now) {
  const documents = [], tokens = new Set(); let token, pages = 0;
  do {
    const queryParams = new URLSearchParams({ pageSize: '100' });
    queryParams.append('mask.fieldPaths', 'status'); queryParams.append('mask.fieldPaths', 'expiresAt');
    if (token) queryParams.set('pageToken', token);
    const response = (await client.get(`projects/${project}/databases/(default)/documents/accessInvites`, { queryParams })).body;
    for (const doc of response.documents ?? []) { assert(doc.name?.startsWith(`projects/${project}/databases/(default)/documents/accessInvites/`)); documents.push(doc); }
    token = response.nextPageToken; pages++;
    if (token) { assert(typeof token === 'string' && !tokens.has(token) && pages < 10, 'Invitation pagination changed or too large'); tokens.add(token); }
  } while (token);
  return { at: new Date(clock()).toISOString(), projectId: project, pages, ...summarizeInvitations(documents, clock()), fieldsRead: ['status', 'expiresAt'], cloudWrites: 0, contactReads: 0, tokenReads: 0, grantReads: 0 };
}
export async function main(args = process.argv.slice(2)) {
  const options = {};
  for (let i = 0; i < args.length; i++) {
    const key = args[i]; assert(['--approval', '--invitation-preflight', '--out', '--plan-only', '--preflight', '--apply', '--reconcile', '--confirm-plan-sha256'].includes(key) && !Object.hasOwn(options, key), 'Unknown or duplicate option');
    options[key] = ['--plan-only', '--preflight', '--apply', '--reconcile'].includes(key) ? true : args[++i];
    assert(options[key] && !String(options[key]).startsWith('--'), 'Missing option');
  }
  assert.equal(['--plan-only', '--preflight', '--apply', '--reconcile'].filter(k => options[k]).length, 1, 'Choose one explicit mode');
  assert(options['--approval'] && options['--invitation-preflight'] && options['--out']);
  assert.equal(Boolean(options['--apply']), Boolean(options['--confirm-plan-sha256']));
  const approval = JSON.parse(readFileSync(options['--approval'], 'utf8')), plan = enablePlan(approval);
  assert.equal(approval.projectId, project); assert.equal(process.versions.node.split('.')[0], '22');
  const git = (...v) => execFileSync('git', v, { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
  assert.equal(git('rev-parse', 'HEAD'), approval.releaseSha, 'Exact approved release HEAD required');
  if (!options['--plan-only']) assert.equal(git('status', '--porcelain', '--untracked-files=all'), '', 'Clean approved release required');
  for (const [key, value] of Object.entries(process.env)) if (value) {
    assert(!/EMULATOR|^(?:FIREBASE_CONFIG|FIREBASE_TOKEN|GOOGLE_APPLICATION_CREDENTIALS|GOOGLE_CLOUD_QUOTA_PROJECT|NODE_OPTIONS|FIREBASE_CLI_EXPERIMENTS)$|(?:FIREBASE|FIRESTORE|IAM|CLOUD_RUN).*_(?:URL|ORIGIN)$/u.test(key), 'Unexpected environment override');
    if (['GCLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT', 'FIREBASE_PROJECT_ID'].includes(key)) assert.equal(value, project);
  }
  const bytes = readFileSync(options['--invitation-preflight']);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), approval.invitationSummarySha256, 'Reviewed invitation summary changed');
  assertInvitationPreflight(JSON.parse(bytes), project);
  const output = path.resolve(options['--out']), relative = path.relative(root, output);
  assert(relative.startsWith('.local-data' + path.sep) && !relative.split(path.sep).includes('..') && !path.isAbsolute(relative));
  assert.equal(realpathSync(path.dirname(output)).toLowerCase(), path.dirname(output).toLowerCase());
  assert(git('check-ignore', '--', output));
  const fd = openSync(output, 'wx'); let commitAttempted = false;
  const record = value => { writeSync(fd, JSON.stringify({ at: new Date().toISOString(), projectId: project, releaseSha: approval.releaseSha, ...value }) + '\n'); fsyncSync(fd); };
  try {
    record({ mode: 'STARTED', planSha256: plan.planSha256 });
    if (options['--plan-only']) { record({ mode: 'OFFLINE_PLAN', plan }); console.log(JSON.stringify({ mode: 'OFFLINE_PLAN', planSha256: plan.planSha256, auditName: plan.auditName, cloudRequests: 0 })); return; }
    const require = createRequire(import.meta.url), cli = n => require(n === 'package' ? 'firebase-tools/package.json' : 'firebase-tools/lib/' + n);
    // Existing direction-neutral adapter fixes target/account/CLI and retries:0.
    const store = await connectPauseStore(plan, cli);
    const client = new (cli('apiv2').Client)({ urlPrefix: 'https://firestore.googleapis.com', apiVersion: 'v1' });
    store.readInvitationSummary = () => readMaskedInvitations(client);
    const result = await executeEnable({ approval, store, apply: Boolean(options['--apply']), confirmPlanSha256: options['--confirm-plan-sha256'], beforeCommit: value => {
      // A fixed per-approval fence survives process failure. Reconciliation is
      // read-only; never remove this marker or invent a new approval to retry.
      const marker = path.join(root, '.local-data', 'collaboration-enable-' + plan.approvalSha256 + '.attempt');
      const attempt = openSync(marker, 'wx');
      try { writeSync(attempt, plan.planSha256 + '\n'); fsyncSync(attempt); } finally { closeSync(attempt); }
      record(value); commitAttempted = true;
    } });
    record(result); console.log(JSON.stringify({ mode: result.mode, planSha256: plan.planSha256, auditName: plan.auditName, writes: result.writes ?? 0 }));
  } catch (error) {
    record({ mode: commitAttempted ? 'OUTCOME_UNCONFIRMED' : 'STOPPED_WITHOUT_COMMIT_ATTEMPT', reason: error.code === 'ERR_ASSERTION' ? String(error.message).split('\n')[0] : 'Request failed; response payload omitted', instruction: 'Preserve journal and attempt marker. Use --reconcile with the SAME approval; never advance expected revision or retry a write blindly.' });
    process.exitCode = 1;
  } finally { closeSync(fd); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
