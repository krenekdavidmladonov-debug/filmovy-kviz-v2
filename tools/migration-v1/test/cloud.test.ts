import { readFile } from 'node:fs/promises';
import { describe, expect, test } from 'vitest';
import { sourceReader, validateCredential } from '../src/cloud-adapters.js';
import { parseCloudArguments } from '../src/cloud-cli.js';
import { assertCloudSelection, classify, createInventory, createSourceArtifact, STAGING, transformedArtifact, validateSourceArtifact } from '../src/cloud-contract.js';
import { importToTarget } from '../src/cloud-import.js';
import { createPlan, mediaStatus, validatePlan } from '../src/cloud-plan.js';
import { canonical, contentFingerprint } from '../src/fingerprint.js';
import { normalizeV1Library } from '../src/normalize.js';
import { sanitizeLibrary } from '../src/sanitize.js';
import { createOnlyQuiz, inspectTarget, quizDocuments, type PrivateDocument, type PrivateTargetStore } from '../src/target-store.js';
import { transformLibrary } from '../src/transform.js';
import type { JsonObject, V1LibrarySnapshot, V2QuizDocument } from '../src/types.js';

const selection = { sourceProject: 'source-fixture-project', targetProject: STAGING };
const time = new Date();
function fixture(size = 3): V1LibrarySnapshot {
  return { schemaVersion: 1, collection: 'library', documents: [{ id: 'quiz-one', data: {
    title: 'Synthetic quiz', email: 'fake@example.test', token: 'FAKE_TOKEN', secret: 'FAKE_SECRET', unknownMetadata: 'DROP_ME',
    data: { settings: { scaleTitle: 1, fakeSecret: 'DROP_ME' }, quiz: Array.from({ length: size }, (_, i) => ({
      type: 'question', text: 'Question ' + i, correct: 'Synthetic answer ' + i, roundHeader: 'Round', email: 'fake@example.test',
      token: 'FAKE_TOKEN', credentials: 'DROP_ME', media: { src: '', token: 'FAKE_TOKEN' },
    })) },
  } }] };
}
const artifact = (size = 3) => createSourceArtifact(fixture(size), selection.sourceProject, time);
class MemoryStore implements PrivateTargetStore {
  readonly documents = new Map<string, JsonObject>();
  writes = 0; calls = 0; failCall = 0; race = false;
  async listQuizIds() { await Promise.resolve(); return [...new Set([...this.documents.keys()].map(k => k.split('/')[1]!))]; }
  async readQuiz(id: string) {
    await Promise.resolve();
    const root = 'quizzes/' + id;
    const children = (prefix: string) => [...this.documents.entries()].filter(([p]) => p.startsWith(prefix + '/') && p.split('/').length === prefix.split('/').length + 1);
    const quiz: V2QuizDocument = { id, data: structuredClone(this.documents.get(root) ?? {}),
      slides: children(root + '/slides').map(([p, data]) => ({ id: p.split('/').at(-1)!, quizId: id, data: structuredClone(data) })),
      rounds: children(root + '/rounds').map(([p, data]) => ({ id: p.split('/').at(-1)!, quizId: id, data: structuredClone(data),
        questions: children(p + '/questions').map(([qp, qd]) => ({ id: qp.split('/').at(-1)!, quizId: id, roundId: p.split('/').at(-1)!, data: structuredClone(qd) })) })) };
    return { quiz, exists: this.documents.has(root), pending: this.documents.has('migrationV1Imports/' + id) && !this.documents.has('migrationV1Imports/' + id + '/state/complete') };
  }
  async createBatch(docs: readonly PrivateDocument[]) {
    await Promise.resolve();
    this.calls++;
    if (this.failCall === this.calls) throw new Error('Injected storage failure');
    if (this.race) { this.race = false; this.documents.set(docs[0]!.path, { title: 'Racing editor' }); }
    if (docs.some(d => this.documents.has(d.path))) throw new Error('Already exists');
    for (const d of docs) this.documents.set(d.path, structuredClone(d.data)); this.writes += docs.length;
  }
}
async function prepare(store = new MemoryStore(), size = 3) {
  const source = artifact(size); const inventory = await inspectTarget(store, STAGING); const validation = createPlan(source, inventory, time);
  return { store, source, inventory, validation, selection, confirmStagingWrite: true };
}
describe('cloud migration safety without cloud', () => {
  test('source API is read-only and removes nested fixture secrets before export', async () => {
    const reader = sourceReader({ getLibrary: () => Promise.resolve(fixture().documents) });
    expect(Object.keys(reader).sort()).toEqual(['close', 'readLibrary']);
    const exported = await reader.readLibrary(); const json = JSON.stringify(exported);
    for (const text of ['fake@example.test', 'FAKE_TOKEN', 'FAKE_SECRET', 'DROP_ME', 'unknownMetadata']) expect(json).not.toContain(text);
    expect(exported.documents[0]!.data.slides).toHaveLength(3);
    const sourceCode = await readFile(new URL('../src/cloud-adapters.ts', import.meta.url), 'utf8');
    const sourcePart = sourceCode.slice(sourceCode.indexOf('export async function openCloudSource'), sourceCode.indexOf('function portable'));
    expect(sourcePart).not.toMatch(/\.(set|update|delete|batch|runTransaction|commit)\(/u);
    expect(sourcePart).toContain("collection('library').select(");
  });
  test('same sanitization protects emulator transform legacy data', () => {
    const output = transformLibrary(normalizeV1Library(fixture()));
    for (const v of ['FAKE_TOKEN', 'FAKE_SECRET', 'DROP_ME', 'fake@example.test']) expect(JSON.stringify(output)).not.toContain(v);
    expect(output[0]!.data).not.toHaveProperty('correctAnswer');
    expect(output[0]!.slides[0]!.data.correctAnswer).toBe('Synthetic answer 0');
    expect(quizDocuments(output[0]!).every(d => d.path.startsWith('quizzes/'))).toBe(true);
  });
  test('unknown meaningful types and structured sensitive values fail closed', () => {
    const input = fixture(); (input.documents[0]!.data.data as JsonObject).quiz = [{ type: 'mystery', text: 'Unknown', correct: 'A' }];
    expect(() => createSourceArtifact(input, selection.sourceProject)).toThrow(/UNMAPPED/u);
    (input.documents[0]!.data.data as JsonObject).quiz = [{ type: 'question', correct: { token: 'FAKE' } }];
    expect(() => sanitizeLibrary(input)).toThrow(/structured/u);
  });
  test('rejects ambiguous input arrays and unsafe IDs', () => {
    const input = fixture(); input.documents[0]!.data.slides = [];
    expect(() => sanitizeLibrary(input)).toThrow(/Ambiguous/u);
    expect(() => sanitizeLibrary({ ...fixture(), documents: [{ id: '../bad', data: { slides: [] } }] })).toThrow(/Unsafe/u);
  });
  test('blocks a dataset above the current editor slide limit', () => {
    expect(() => artifact(401)).toThrow(/editor limit/u);
    expect(artifact(400).counts.slides).toBe(400);
  });
  test('immutable export has verified schema, counts and hash; alteration rejected', () => {
    const a = artifact(); expect(validateSourceArtifact(a, selection)).toEqual(a);
    expect(() => validateSourceArtifact({ ...a, counts: {} }, selection)).toThrow(/artifact/u);
    expect(() => validateSourceArtifact({ ...a, snapshot: fixture() }, selection)).toThrow(/artifact/u);
    expect(() => validateSourceArtifact(a, { ...selection, sourceProject: 'another-source' })).toThrow(/artifact/u);
  });
  test('fingerprint ignores timestamps/revision and is stable across key/array enumeration', () => {
    const q = transformedArtifact(artifact())[0]!; const changed = structuredClone(q);
    changed.data.updatedAt = { __migrationTimestamp: new Date(0).toISOString() }; changed.data.revision = 42;
    (changed.slides as unknown[]).reverse();
    const reordered = { ...changed, data: Object.fromEntries(Object.entries(changed.data).reverse()) };
    expect(contentFingerprint(q)).toBe(contentFingerprint(reordered));
    expect(canonical({ b: 2, a: 1 })).toBe(canonical({ a: 1, b: 2 }));
  });
  test.each(['text', 'correctAnswer', 'position'])('fingerprint detects real %s changes', field => {
    const q = transformedArtifact(artifact())[0]!; const changed = structuredClone(q);
    changed.slides[0]!.data[field] = field === 'position' ? 5 : 'Changed';
    expect(contentFingerprint(q)).not.toBe(contentFingerprint(changed));
  });
  test('classifies NEW and preserves unrelated synthetic quiz', async () => {
    const store = new MemoryStore(); store.documents.set('quizzes/synthetic', { title: 'Synthetic sentinel' });
    const options = await prepare(store); const before = canonical(store.documents.get('quizzes/synthetic'));
    expect(options.validation.quizzes[0]!.classification).toBe('NEW');
    await importToTarget(options, {});
    expect(canonical(store.documents.get('quizzes/synthetic'))).toBe(before);
  });
  test('create-only import, readback, IDENTICAL and second run with zero writes', async () => {
    const options = await prepare(); const first = await importToTarget(options, {});
    expect(first.created).toBe(1); const writes = options.store.writes;
    const second = await importToTarget(options, {});
    expect(second.identical).toBe(1); expect(options.store.writes).toBe(writes);
  });
  test('changed content with unchanged stored provenance hash is CONFLICT and zero writes', async () => {
    const options = await prepare(); await importToTarget(options, {});
    options.store.documents.get('quizzes/quiz-one/slides/slide-001')!.correctAnswer = 'Edited by V2';
    const inv = await inspectTarget(options.store, STAGING);
    expect(classify(transformedArtifact(options.source)[0]!, inv).classification).toBe('CONFLICT');
    const writes = options.store.writes;
    await expect(importToTarget(options, {})).rejects.toThrow(/collision/u); expect(options.store.writes).toBe(writes);
  });
  test('unknown provenance / duplicate provenance / orphan is AMBIGUOUS', () => {
    const q = transformedArtifact(artifact())[0]!;
    const entry = { id: q.id, title: 'Existing', provenance: null, contentFingerprint: null, rounds: 0, questions: 0, incomplete: false };
    expect(classify(q, createInventory([entry], STAGING)).classification).toBe('AMBIGUOUS');
    const provenance = q.data.legacy as JsonObject;
    expect(classify(q, createInventory([{ ...entry, provenance }, { ...entry, id: 'alias', provenance }], STAGING)).classification).toBe('AMBIGUOUS');
    expect(classify(q, createInventory([{ ...entry, incomplete: true }], STAGING)).classification).toBe('AMBIGUOUS');
  });
  test('existence race fails atomically without overwriting existing data', async () => {
    const options = await prepare(); options.store.race = true;
    await expect(importToTarget(options, {})).rejects.toThrow(/Already exists/u);
    expect(options.store.writes).toBe(0);
    expect(options.store.documents.get('quizzes/quiz-one')).toEqual({ title: 'Racing editor' });
  });
  test('large quiz is published only after all batches match, then is identical', async () => {
    const options = await prepare(new MemoryStore(), 260);
    await importToTarget(options, {});
    expect((await options.store.readQuiz('quiz-one')).pending).toBe(false);
    expect(options.store.calls).toBeGreaterThan(2);
    expect((await importToTarget(options, {})).identical).toBe(1);
  });
  test.each([2, 3, 4])('large quiz failure at batch %s leaves no visible library root and blocks retries', async failCall => {
    const options = await prepare(new MemoryStore(), 260); options.store.failCall = failCall;
    await expect(importToTarget(options, {})).rejects.toThrow(/Injected/u);
    expect(options.store.documents.has('quizzes/quiz-one')).toBe(false);
    expect((await options.store.readQuiz('quiz-one')).pending).toBe(true);
    const writes = options.store.writes; options.store.failCall = 0;
    await expect(importToTarget(options, {})).rejects.toThrow(/collision/u);
    expect(options.store.writes).toBe(writes);
  });
  test('oversized document blocks before any partial write', async () => {
    const store = new MemoryStore(); const q = transformedArtifact(artifact())[0]!;
    q.slides[0]!.data.text = 'x'.repeat(810_000);
    await expect(createOnlyQuiz(store, q)).rejects.toThrow(/size bound/u); expect(store.writes).toBe(0);
  });
  test('validation artifact missing/stale/modified/blocked is rejected', async () => {
    const o = await prepare();
    for (const p of [undefined, { ...o.validation, status: 'BLOCKED' }, { ...o.validation, sourceFingerprint: 'fake' }]) {
      expect(() => validatePlan(p, o.source, o.inventory)).toThrow(/artifact/u);
    }
    expect(() => validatePlan(o.validation, o.source, o.inventory, new Date(time.getTime() + 86_400_001))).toThrow(/stale/u);
  });
  test('media syntax classification does not perform network availability requests', () => {
    const base = { sourceField: 'mediaRaw', role: 'prompt' as const, kind: 'video' as const };
    expect(mediaStatus({ ...base, value: 'abcdefghijk', validUrl: false })).toBe('LEGACY');
    expect(mediaStatus({ ...base, value: 'javascript:invalid', validUrl: false })).toBe('BROKEN');
    expect(mediaStatus({ ...base, kind: 'unknown', value: 'opaque' })).toBe('UNSUPPORTED');
  });
  test('credentials are explicit, project-bound and never inherited from default auth', () => {
    expect(() => validateCredential({ type: 'authorized_user' }, selection.sourceProject)).toThrow(/credential/u);
    expect(() => validateCredential({ type: 'service_account', project_id: 'other' }, selection.sourceProject)).toThrow(/credential/u);
  });
});
const args = ['import-cloud', '--source-project', selection.sourceProject, '--target-project', STAGING,
  '--target-credential', 'outside-repo.json', '--input', '.local-data/export.json', '--inventory', '.local-data/inventory.json',
  '--validation', '.local-data/validation.json', '--output', '.local-data/result.json', '--confirm-staging-write'];
describe('explicit CLI guards', () => {
  test.each(['--source-project', '--target-project', '--target-credential', '--input', '--inventory', '--validation', '--confirm-staging-write'])('missing %s refuses import', flag => {
    const copy = [...args]; const i = copy.indexOf(flag); copy.splice(i, flag === '--confirm-staging-write' ? 1 : 2);
    expect(() => parseCloudArguments(copy, {})).toThrow();
  });
  test('wrong target and source equals target refuse before auth', () => {
    for (const targetProject of ['production-project', '', 'demo-local']) expect(() => assertCloudSelection({ ...selection, targetProject }, {})).toThrow();
    expect(() => assertCloudSelection({ ...selection, sourceProject: STAGING }, {})).toThrow();
  });
  test('emulator/cloud mix refuses; environment project never substitutes explicit flags', () => {
    expect(() => parseCloudArguments(args, { FIRESTORE_EMULATOR_HOST: 'localhost:8080' })).toThrow(/mix/u);
    expect(() => parseCloudArguments(['import-cloud'], { GOOGLE_CLOUD_PROJECT: STAGING })).toThrow();
    expect(parseCloudArguments(args, {}).targetProject).toBe(STAGING);
  });
});
