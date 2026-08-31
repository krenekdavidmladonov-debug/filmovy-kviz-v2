import path from 'node:path';

import { readV1Library } from './read.js';
import { normalizeV1Library } from './normalize.js';
import { transformLibrary } from './transform.js';
import type { MigrationReport } from './types.js';
import {
  calculateOutputStats,
  calculateSourceStats,
  createQuizReport,
  validateNormalizedInput,
  validateOutput,
} from './validate.js';
import { writeToFirestoreEmulator } from './write.js';

export type MigrationMode = MigrationReport['mode'];

export interface MigrationRunOptions {
  readonly inputPath: string;
  readonly mode: MigrationMode;
  readonly now?: Date;
}

export async function runMigration(options: MigrationRunOptions): Promise<MigrationReport> {
  const snapshot = await readV1Library(options.inputPath);
  const normalized = normalizeV1Library(snapshot);
  validateNormalizedInput(normalized);
  const transformed = transformLibrary(normalized, options.now);
  validateOutput(normalized, transformed);

  let wroteToEmulator = false;
  if (options.mode === 'emulator') {
    await writeToFirestoreEmulator(transformed);
    wroteToEmulator = true;
  }

  return {
    status: 'PASS',
    mode: options.mode,
    source: path.relative(process.cwd(), options.inputPath),
    totalsBefore: calculateSourceStats(normalized),
    totalsAfter: calculateOutputStats(transformed),
    quizzes: normalized.map((quiz, index) => createQuizReport(quiz, transformed[index]!)),
    wroteToEmulator,
  };
}
