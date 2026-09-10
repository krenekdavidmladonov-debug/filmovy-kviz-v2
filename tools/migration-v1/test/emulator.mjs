import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { assertSafeEmulatorEnvironment, writeToFirestoreEmulator } from '../lib/write.js';
import { normalizeV1Library } from '../lib/normalize.js';
import { transformLibrary } from '../lib/transform.js';
import { sourceReader, targetStore } from '../lib/cloud-adapters.js';
import { createSourceArtifact, STAGING } from '../lib/cloud-contract.js';
import { createPlan } from '../lib/cloud-plan.js';
import { importToTarget } from '../lib/cloud-import.js';
import { inspectTarget, createOnlyQuiz } from '../lib/target-store.js';
import { transformedArtifact } from '../lib/cloud-contract.js';

// No cloud factory or real credentials: the existing exact localhost + demo guard.
const { projectId } = assertSafeEmulatorEnvironment();
const app = initializeApp({ projectId }, 'migration-contract-emulator');
const db = getFirestore(app);
const selection = { sourceProject: 'source-fixture-project', targetProject: STAGING };
let passed = 0;
async function check(name, action) { await action(); passed++; console.log('PASS ' + name); }
function artifact(id, count = 3) {
  return createSourceArtifact({ schemaVersion: 1, collection: 'library', documents: [{ id, data: { title: 'Synthetic',
    slides: Array.from({ length: count }, (_, i) => ({ type: 'question', text: 'Synthetic ' + i, correct: 'Synthetic answer', roundHeader: 'Round' })) } }] }, selection.sourceProject);
}
try {
  await check('original emulator write and independent verifier', async () => {
    const input = JSON.parse(await readFile(new URL('./fixtures/library.json', import.meta.url), 'utf8'));
    await mkdir('.local-data/v1-export', { recursive: true });
    await writeFile('.local-data/v1-export/library.json', JSON.stringify(input), { flag: 'wx' });
    await writeToFirestoreEmulator(transformLibrary(normalizeV1Library(input)));
    const result = spawnSync(process.execPath, ['tools/migration-v1/lib/verify-emulator.js'], { env: process.env, encoding: 'utf8' });
    assert.equal(result.status, 0, 'Independent synthetic emulator readback failed');
  });
  const store = targetStore(db);
  const original = await db.doc('quizzes/synthetic-real-shapes').get();
  await check('create-only import and second run with zero new documents', async () => {
    const source = artifact('cloud-fixture');
    const inventory = await inspectTarget(store, STAGING); const validation = createPlan(source, inventory);
    const o = { selection, confirmStagingWrite: true, source, inventory, validation, store };
    assert.equal((await importToTarget(o, {})).created, 1);
    assert.equal((await importToTarget(o, {})).identical, 1);
    assert.equal((await db.doc('quizzes/cloud-fixture').get()).data().questionCount, 3);
  });
  await check('unrelated original emulator quiz unchanged', async () => {
    assert.deepEqual((await db.doc('quizzes/synthetic-real-shapes').get()).data(), original.data());
  });
  await check('existence precondition aborts entire batch', async () => {
    await db.doc('quizzes/race-existing').create({ sentinel: true });
    await assert.rejects(store.createBatch([{ path: 'quizzes/race-new', data: { sentinel: true } },
      { path: 'quizzes/race-existing', data: { sentinel: false } }]));
    assert.equal((await db.doc('quizzes/race-new').get()).exists, false);
    assert.equal((await db.doc('quizzes/race-existing').get()).data().sentinel, true);
  });
  await check('large import root published last and journal completed', async () => {
    const q = transformedArtifact(artifact('large-fixture', 260))[0];
    await createOnlyQuiz(store, q);
    const state = await store.readQuiz(q.id);
    assert.equal(state.exists, true); assert.equal(state.pending, false);
    assert.equal(state.quiz.slides.length, 260);
  });
  await check('interrupted large import invisible in root query and inventoried as incomplete', async () => {
    let calls = 0;
    const faulty = { ...store, async createBatch(docs) { if (++calls === 3) throw new Error('Injected failure'); await store.createBatch(docs); } };
    const q = transformedArtifact(artifact('partial-fixture', 260))[0];
    await assert.rejects(createOnlyQuiz(faulty, q));
    const rootIds = (await db.collection('quizzes').get()).docs.map(d => d.id);
    assert.equal(rootIds.includes(q.id), false);
    const inventory = await inspectTarget(store, STAGING);
    assert.equal(inventory.entries.find(e => e.id === q.id).incomplete, true);
  });
  await check('nullable media source structure survives Firestore extraction and private create-only readback', async () => {
    const input = JSON.parse(await readFile(new URL('./fixtures/cloud-null-media.json', import.meta.url), 'utf8'));
    for (const document of input.documents) await db.collection('library').doc(document.id).create(document.data);
    const reader = sourceReader({ async getLibrary() {
      const result = await db.collection('library').select('name', 'data.quiz', 'data.settings.defaultAudioTrigger',
        'data.settings.scaleTitle', 'data.settings.time_R1').orderBy('__name__').get();
      return result.docs.map(document => ({ id: document.id, data: document.data() }));
    } });
    const source = createSourceArtifact(await reader.readLibrary(), selection.sourceProject);
    assert.deepEqual(source.counts, { quizzes: 2, slides: 14, rounds: 3, questions: 7, correctAnswers: 7, images: 1, audio: 1, video: 1 });
    const inventory = await inspectTarget(store, STAGING);
    const validation = createPlan(source, inventory);
    const result = await importToTarget({ selection, source, inventory, validation, store, confirmStagingWrite: true }, {});
    assert.equal(result.created, 2);
    const quiz = await store.readQuiz('null-media-one');
    assert.equal(quiz.quiz.slides[0].data.legacy.raw.media, null);
    assert.equal(quiz.quiz.rounds.flatMap(round => round.questions).length, 5);
    const again = createPlan(source, await inspectTarget(store, STAGING));
    assert.equal(again.totals.identical, 2);
    assert.equal(again.totals.new, 0);
    await reader.close();
  });
  console.log(JSON.stringify({ status: 'PASS', emulatorContracts: passed, realCloudCalls: 0 }));
} catch {
  console.error('Migration emulator contract failed; synthetic payload suppressed.');
  process.exitCode = 1;
} finally { await deleteApp(app); }
