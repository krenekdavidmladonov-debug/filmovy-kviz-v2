import assert from 'node:assert/strict';
import { readFileSync, openSync, writeFileSync, fsyncSync, closeSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import path from 'node:path';
import { executePause, pausePlan } from './pause-collaboration-core.mjs';
import { STAGING_PROJECT } from '../staging/guard.mjs';
import { connectPauseStore } from './pause-collaboration-store.mjs';

const args = process.argv.slice(2), options = {};
for (let i = 0; i < args.length; i++) {
  const key = args[i];
  assert(['--approval', '--out', '--apply', '--confirm-plan-sha256'].includes(key) && !Object.hasOwn(options, key), 'Unknown or duplicate option');
  options[key] = key === '--apply' ? true : args[++i];
  assert(options[key] && !String(options[key]).startsWith('--'), 'Missing option value');
}
assert(options['--approval'] && options['--out'], 'Usage: --approval reviewed.json --out NEW-ignored-receipt.json [--apply --confirm-plan-sha256 HASH]');
assert(Boolean(options['--apply']) === Boolean(options['--confirm-plan-sha256']), 'Apply and confirmation hash must be supplied together');
const approval = JSON.parse(readFileSync(options['--approval'], 'utf8'));
assert.equal(approval.projectId, STAGING_PROJECT, 'Only V2 staging is permitted');
const plan = pausePlan(approval);
if (options['--apply']) assert.equal(options['--confirm-plan-sha256'], plan.planSha256, 'Reviewed plan mismatch');
for (const [key, value] of Object.entries(process.env)) {
  if (/EMULATOR_HOST|^(FIREBASE_CONFIG|FIREBASE_TOKEN|GOOGLE_APPLICATION_CREDENTIALS|GOOGLE_CLOUD_QUOTA_PROJECT)$/u.test(key)) assert(!value, `Remove target or credential override ${key}`);
  if (['GCLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT', 'FIREBASE_PROJECT_ID'].includes(key) && value) assert.equal(value, STAGING_PROJECT, 'Foreign project environment');
}
const root = realpathSync(fileURLToPath(new URL('../../', import.meta.url)));
const output = path.resolve(options['--out']);
const relative = path.relative(root, output);
assert(relative.startsWith(`.local-data${path.sep}`) && !path.isAbsolute(relative), 'Receipt must be inside repository .local-data');
const actualParent = realpathSync(path.dirname(output));
assert.equal(actualParent.toLowerCase(), path.dirname(output).toLowerCase(), 'Receipt parent must not redirect through a link');
assert.equal(execFileSync('git', ['check-ignore', '--', output], { cwd: root, encoding: 'utf8' }).trim().length > 0, true, 'Receipt must be ignored');
const fd = openSync(output, 'wx');
let commitAttempted = false;
const record = value => { writeFileSync(fd, `${JSON.stringify({ at: new Date().toISOString(), projectId: STAGING_PROJECT, releaseSha: approval.releaseSha, ...value })}\n`); fsyncSync(fd); };
try {
  record({ mode: 'STARTED', apply: Boolean(options['--apply']), planSha256: plan.planSha256 });
  const require = createRequire(import.meta.url);
  const store = await connectPauseStore(plan, name => require(name === 'package' ? 'firebase-tools/package.json' : `firebase-tools/lib/${name}`));
  const result = await executePause({ approval, store, apply: Boolean(options['--apply']), confirmPlanSha256: options['--confirm-plan-sha256'],
    beforeCommit: value => { record(value); commitAttempted = true; } });
  record(result);
  console.log(JSON.stringify(result));
} catch (error) {
  const result = { mode: commitAttempted ? 'OUTCOME_UNCONFIRMED' : 'STOPPED_WITHOUT_COMMIT_ATTEMPT',
    reason: error.code === 'ERR_ASSERTION' ? String(error.message).split('\n')[0] : 'Operator request failed; response payload deliberately omitted',
    instruction: commitAttempted ? 'Preserve receipt; inspect audit and state with the same approval before any retry. Never change expected revision to force a retry.' : 'Review approval, current state, access and target environment. No approval or credential is inferred.' };
  record(result);
  console.error(JSON.stringify(result));
  process.exitCode = 1;
} finally { closeSync(fd); }
