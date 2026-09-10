import { mkdir, readFile, realpath, writeFile, chmod } from 'node:fs/promises';
import path from 'node:path';
import { openCloudSource, openCloudTarget } from './cloud-adapters.js';
import { assertCloudSelection, createSourceArtifact, validateSourceArtifact, validateInventory, type CloudSelection } from './cloud-contract.js';
import { createPlan, validatePlan } from './cloud-plan.js';
import { importToTarget } from './cloud-import.js';
import { MigrationSafetyError } from './errors.js';
import { inspectTarget } from './target-store.js';

export const cloudModes = ['export-cloud', 'inspect-target-cloud', 'dry-run-cloud', 'import-cloud'];
interface CloudOptions extends CloudSelection {
  mode: string; input?: string; inventory?: string; validation?: string; output: string;
  sourceCredential?: string; targetCredential?: string; confirmSourceReadOnly: boolean; confirmStagingWrite: boolean;
}
export function parseCloudArguments(args: readonly string[], environment: NodeJS.ProcessEnv = process.env): CloudOptions {
  const mode = args[0] ?? '';
  if (!cloudModes.includes(mode)) throw new MigrationSafetyError('Unknown explicit cloud mode.');
  const values = new Map<string, string>();
  const flags = new Set(['--confirm-source-read-only', '--confirm-staging-write']);
  const allowed = new Set(['--source-project', '--target-project', '--input', '--inventory', '--validation', '--output', '--source-credential', '--target-credential', ...flags]);
  for (let i = 1; i < args.length; i++) {
    const key = args[i]!;
    if (!allowed.has(key) || values.has(key)) throw new MigrationSafetyError('Unknown or duplicate cloud option.');
    const value = flags.has(key) ? 'true' : args[++i];
    if (!value || value.startsWith('--')) throw new MigrationSafetyError('Missing cloud option value.');
    values.set(key, value);
  }
  const options: CloudOptions = { mode, sourceProject: values.get('--source-project') ?? '', targetProject: values.get('--target-project') ?? '',
    output: values.get('--output') ?? '', input: values.get('--input'), inventory: values.get('--inventory'), validation: values.get('--validation'),
    sourceCredential: values.get('--source-credential'), targetCredential: values.get('--target-credential'),
    confirmSourceReadOnly: values.has('--confirm-source-read-only'), confirmStagingWrite: values.has('--confirm-staging-write') };
  assertCloudSelection(options, environment);
  if (!options.output) throw new MigrationSafetyError('Explicit --output under .local-data is required.');
  if (mode === 'export-cloud' && (!options.sourceCredential || !options.confirmSourceReadOnly)) throw new MigrationSafetyError('Source credential and --confirm-source-read-only required.');
  if (['inspect-target-cloud', 'import-cloud'].includes(mode) && !options.targetCredential) throw new MigrationSafetyError('Explicit target credential required.');
  if (['dry-run-cloud', 'import-cloud'].includes(mode) && (!options.input || !options.inventory)) throw new MigrationSafetyError('Source export and target inventory artifacts required.');
  if (mode === 'import-cloud' && (!options.validation || !options.confirmStagingWrite)) throw new MigrationSafetyError('Validation artifact and --confirm-staging-write required; no write.');
  if (mode !== 'import-cloud' && options.confirmStagingWrite) throw new MigrationSafetyError('Write confirmation is valid only for import-cloud.');
  if (mode !== 'export-cloud' && options.sourceCredential) throw new MigrationSafetyError('Source credentials are only accepted by export-cloud.');
  return options;
}
export async function localArtifactPath(file: string, output = false): Promise<string> {
  const local = path.resolve('.local-data'); const requested = path.resolve(file);
  const inside = (root: string, candidate: string) => { const r = path.relative(root, candidate);
    return r !== '' && r !== '..' && !r.startsWith('..' + path.sep) && !path.isAbsolute(r); };
  if (!inside(local, requested)) throw new MigrationSafetyError('Artifact must stay under .local-data.');
  if (output) await mkdir(local, { recursive: true });
  const realLocal = await realpath(local);
  // Check existing ancestors before creating any output directory, including junctions.
  let ancestor = output ? path.dirname(requested) : requested;
  while (true) { try { const real = await realpath(ancestor);
    if (real !== realLocal && !inside(realLocal, real)) throw new MigrationSafetyError('Artifact symlink escape.');
    break;
  } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; const parent = path.dirname(ancestor);
    if (parent === ancestor) throw new MigrationSafetyError('Artifact parent missing.'); ancestor = parent; } }
  if (output) await mkdir(path.dirname(requested), { recursive: true });
  return requested;
}
async function readArtifact(file: string): Promise<unknown> {
  try { return JSON.parse(await readFile(await localArtifactPath(file), 'utf8')) as unknown; }
  catch { throw new MigrationSafetyError('Cannot read valid local artifact; payload suppressed.'); }
}
async function saveArtifact(file: string, body: unknown, immutable = false) {
  await writeFile(file, JSON.stringify(body, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  if (immutable) await chmod(file, 0o400);
}
export async function runCloudCli(args: readonly string[]): Promise<{ status: string; mode: string }> {
  const o = parseCloudArguments(args);
  const output = await localArtifactPath(o.output, true);
  // Refuse existing output before any cloud operation.
  try { await realpath(output); throw new MigrationSafetyError('Output already exists; choose a new artifact path.'); }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  if (o.mode === 'export-cloud') {
    const source = await openCloudSource(o, o.sourceCredential!, o.confirmSourceReadOnly);
    try { const artifact = createSourceArtifact(await source.readLibrary(), o.sourceProject); await saveArtifact(output, artifact, true); }
    finally { await source.close(); }
    return { status: 'PASS', mode: o.mode };
  }
  if (o.mode === 'inspect-target-cloud') {
    const target = await openCloudTarget(o, o.targetCredential!);
    try { await saveArtifact(output, await inspectTarget(target.store, o.targetProject)); }
    finally { await target.close(); }
    return { status: 'PASS', mode: o.mode };
  }
  const source = validateSourceArtifact(await readArtifact(o.input!), o);
  const inventory = validateInventory(await readArtifact(o.inventory!));
  if (o.mode === 'dry-run-cloud') {
    const plan = createPlan(source, inventory); await saveArtifact(output, plan);
    return { status: plan.status, mode: o.mode };
  }
  const validation = validatePlan(await readArtifact(o.validation!), source, inventory);
  const target = await openCloudTarget(o, o.targetCredential!);
  try { await saveArtifact(output, await importToTarget({ selection: o, confirmStagingWrite: o.confirmStagingWrite, source, inventory, validation, store: target.store })); }
  finally { await target.close(); }
  return { status: 'PASS', mode: o.mode };
}
