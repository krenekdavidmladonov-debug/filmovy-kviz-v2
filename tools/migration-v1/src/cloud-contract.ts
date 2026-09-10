import { MigrationSafetyError, MigrationValidationError } from './errors.js';
import { fingerprint, canonical, contentFingerprint } from './fingerprint.js';
import { isUnknownSlideType, normalizeV1Library } from './normalize.js';
import { sanitizeLibrary, assertId, object } from './sanitize.js';
import { transformLibrary } from './transform.js';
import { calculateOutputStats, validateNormalizedInput, validateOutput } from './validate.js';
import type { JsonObject, V1LibrarySnapshot, V2QuizDocument } from './types.js';

export const STAGING = 'filmovy-kviz-v2-staging';
export const TRANSFORM_VERSION = 2;
export interface CloudSelection { sourceProject: string; targetProject: string }
export function assertCloudSelection(selection: CloudSelection, env: NodeJS.ProcessEnv = process.env): void {
  if (!/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/u.test(selection.sourceProject ?? '')
    || selection.sourceProject.startsWith('demo-') || selection.sourceProject === STAGING
    || selection.targetProject !== STAGING) throw new MigrationSafetyError('Explicit distinct source and exact V2 staging target are required.');
  if (['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST', 'FIREBASE_EMULATOR_HUB'].some(k => Boolean(env[k]))
    || env.FUNCTIONS_EMULATOR === 'true') throw new MigrationSafetyError('Cloud/emulator configuration mix is forbidden.');
}
export interface SourceArtifact {
  schemaVersion: 2; transformVersion: 2; sourceProject: string; sourceCollection: 'library';
  exportedAt: string; snapshot: V1LibrarySnapshot; counts: ReturnType<typeof calculateOutputStats>; fingerprint: string;
}
export function createSourceArtifact(snapshot: V1LibrarySnapshot, sourceProject: string, now = new Date()): SourceArtifact {
  const clean = sanitizeLibrary(snapshot);
  const normalized = normalizeV1Library(clean); validateNormalizedInput(normalized);
  if (normalized.some(q => q.slides.some(isUnknownSlideType))) throw new MigrationValidationError('UNMAPPED source type; export blocked.');
  const transformed = transformLibrary(normalized, now); validateOutput(normalized, transformed);
  const body = { schemaVersion: 2 as const, transformVersion: 2 as const, sourceProject, sourceCollection: 'library' as const,
    exportedAt: now.toISOString(), snapshot: clean, counts: calculateOutputStats(transformed) };
  return { ...body, fingerprint: fingerprint(body) };
}
export function validateSourceArtifact(value: unknown, selection: CloudSelection): SourceArtifact {
  const a = value as SourceArtifact;
  try {
    if (a.schemaVersion !== 2 || a.transformVersion !== TRANSFORM_VERSION || a.sourceCollection !== 'library'
      || a.sourceProject !== selection.sourceProject || !Number.isFinite(Date.parse(a.exportedAt))) throw new Error();
    const expected = createSourceArtifact(a.snapshot, selection.sourceProject, new Date(a.exportedAt));
    if (canonical(a) !== canonical(expected)) throw new Error();
    return a;
  } catch { throw new MigrationValidationError('Invalid, altered or incompatible source artifact.'); }
}
export function transformedArtifact(a: SourceArtifact): readonly V2QuizDocument[] {
  const normalized = normalizeV1Library(a.snapshot);
  const quizzes = transformLibrary(normalized, new Date(a.exportedAt)); validateOutput(normalized, quizzes);
  for (const q of quizzes) {
    const provenance = { source: 'v1', sourceProject: a.sourceProject, sourceCollection: 'library', sourceId: q.id,
      exportFingerprint: a.fingerprint, transformVersion: TRANSFORM_VERSION };
    q.data.createdBy = 'migration-v1-cloud'; q.data.updatedBy = 'migration-v1-cloud';
    q.data.legacy = { ...object(q.data.legacy), ...provenance };
    for (const slide of q.slides) slide.data.legacy = { ...object(slide.data.legacy), ...provenance, sourceSlidePosition: slide.data.position! };
    for (const round of q.rounds) {
      round.data.legacy = { ...object(round.data.legacy), ...provenance };
      for (const question of round.questions) question.data.legacy = { ...object(question.data.legacy), ...provenance, sourceSlidePosition: question.data.sourceSlidePosition! };
    }
    object(q.data.legacy).contentFingerprint = contentFingerprint(q);
    assertId(q.id);
  }
  return quizzes;
}
export interface TargetEntry {
  id: string; title: string; provenance: JsonObject | null; contentFingerprint: string | null;
  rounds: number; questions: number; incomplete: boolean;
}
export interface TargetInventory { schemaVersion: 2; targetProject: string; inspectedAt: string; entries: TargetEntry[]; fingerprint: string }
export function createInventory(entries: TargetEntry[], targetProject: string, now = new Date()): TargetInventory {
  const sorted = [...entries].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const body = { schemaVersion: 2 as const, targetProject, inspectedAt: now.toISOString(), entries: sorted };
  return { ...body, fingerprint: fingerprint(body) };
}
export function validateInventory(value: unknown): TargetInventory {
  try {
    const inv = value as TargetInventory;
    if (inv.schemaVersion !== 2 || inv.targetProject !== STAGING || !Array.isArray(inv.entries)
      || !Number.isFinite(Date.parse(inv.inspectedAt))) throw new Error();
    const ids = new Set<string>();
    for (const e of inv.entries) { assertId(e.id); if (ids.has(e.id)) throw new Error(); ids.add(e.id);
      if (typeof e.title !== 'string' || typeof e.incomplete !== 'boolean' || !Number.isInteger(e.rounds) || !Number.isInteger(e.questions)) throw new Error(); }
    if (canonical(inv) !== canonical(createInventory(inv.entries, STAGING, new Date(inv.inspectedAt)))) throw new Error();
    return inv;
  } catch { throw new MigrationValidationError('Invalid target inventory artifact.'); }
}
export type Classification = 'NEW' | 'IDENTICAL' | 'CONFLICT' | 'AMBIGUOUS';
export function classify(q: V2QuizDocument, inventory: TargetInventory): { classification: Classification; targetId: string } {
  const p = object(q.data.legacy);
  const matches = inventory.entries.filter(e => e.id === q.id || (e.provenance?.source === 'v1'
    && e.provenance.sourceProject === p.sourceProject && e.provenance.sourceCollection === 'library' && e.provenance.sourceId === q.id));
  if (matches.length === 0) return { classification: 'NEW', targetId: q.id };
  if (matches.length > 1 || matches[0]!.incomplete) return { classification: 'AMBIGUOUS', targetId: q.id };
  const e = matches[0]!;
  const known = e.provenance?.source === 'v1' && e.provenance.sourceProject === p.sourceProject
    && e.provenance.sourceCollection === 'library' && e.provenance.sourceId === q.id && e.id === q.id;
  return { classification: !known ? 'AMBIGUOUS' : e.contentFingerprint === contentFingerprint(q) ? 'IDENTICAL' : 'CONFLICT', targetId: e.id };
}
