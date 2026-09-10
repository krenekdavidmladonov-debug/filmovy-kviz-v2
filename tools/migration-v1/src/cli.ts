import { cloudModes, runCloudCli } from './cloud-cli.js';
import { realpath } from 'node:fs/promises';
import path from 'node:path';

import { MigrationSafetyError } from './errors.js';
import { runMigration, type MigrationMode } from './pipeline.js';

const modes = new Set<MigrationMode>(['inspect', 'validate', 'dry-run', 'emulator']);

function parseArguments(argv: readonly string[]): { mode: MigrationMode; inputPath: string } {
  const requestedMode = argv[0] ?? 'dry-run';
  if (!modes.has(requestedMode as MigrationMode)) {
    throw new MigrationSafetyError(`Unknown mode: ${requestedMode}.`);
  }
  const inputIndex = argv.indexOf('--input');
  if (inputIndex >= 0 && argv[inputIndex + 1] === undefined) {
    throw new MigrationSafetyError('--input requires a path.');
  }
  const configuredInput = inputIndex >= 0 ? argv[inputIndex + 1] : undefined;
  const inputPath = path.resolve(configuredInput ?? '.local-data/v1-export/library.json');
  const localDataRoot = path.resolve('.local-data');
  const relative = path.relative(localDataRoot, inputPath);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new MigrationSafetyError('Migration input must stay inside .local-data/.');
  }
  return { mode: requestedMode as MigrationMode, inputPath };
}

async function assertNoSymlinkEscape(inputPath: string): Promise<void> {
  const [realInput, realLocalData] = await Promise.all([
    realpath(inputPath),
    realpath(path.resolve('.local-data')),
  ]);
  const relative = path.relative(realLocalData, realInput);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new MigrationSafetyError('Migration input resolves outside .local-data/.');
  }
}

async function main(): Promise<void> {
  if (cloudModes.includes(process.argv[2] ?? '')) {
    const result = await runCloudCli(process.argv.slice(2));
    console.log(JSON.stringify(result));
    if (result.status !== 'PASS') process.exitCode = 1;
    return;
  }
  const options = parseArguments(process.argv.slice(2));
  await assertNoSymlinkEscape(options.inputPath);
  const report = await runMigration(options);
  console.log(JSON.stringify(report, null, 2));
}

void main().catch((error: unknown) => {
  const name = error instanceof Error ? error.name : 'Error';
  const message = error instanceof Error && ['MigrationSafetyError', 'MigrationValidationError'].includes(error.name) ? error.message : 'Migration failed; private payload and credential details suppressed.';
  console.error(JSON.stringify({ status: 'FAILED', error: name, message }, null, 2));
  process.exitCode = 1;
});
