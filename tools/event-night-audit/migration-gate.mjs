import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';

import { runMigration } from '../migration-v1/lib/pipeline.js';

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function main() {
  const commonOutput = execFileSync('git', ['rev-parse', '--git-common-dir'], { encoding: 'utf8' }).trim();
  const primaryRoot = path.dirname(path.resolve(process.cwd(), commonOutput));
  const allowedRoot = await realpath(path.join(primaryRoot, '.local-data/v1-export'));
  const source = await realpath(path.join(allowedRoot, 'library.json'));
  if (path.relative(allowedRoot, source) !== 'library.json') {
    throw new Error('Migration gate source must be the exact managed local export.');
  }
  const before = await readFile(source);
  const validate = await runMigration({ inputPath: source, mode: 'validate' });
  const dryRun = await runMigration({ inputPath: source, mode: 'dry-run' });
  const after = await readFile(source);
  const sourceHashMatch = sha256(before) === sha256(after);
  const pass = validate.status === 'PASS'
    && dryRun.status === 'PASS'
    && !validate.wroteToEmulator
    && !dryRun.wroteToEmulator
    && sourceHashMatch;
  console.log(JSON.stringify({
    status: pass ? 'PASS' : 'FAIL',
    validate: validate.status,
    dryRun: dryRun.status,
    totalsBefore: validate.totalsBefore,
    totalsAfter: validate.totalsAfter,
    sourceHashMatch,
  }));
  if (!pass) process.exitCode = 1;
}

await main();
