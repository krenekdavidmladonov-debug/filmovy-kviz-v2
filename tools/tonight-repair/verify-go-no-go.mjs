import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { deleteApp, initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import {
  collection,
  connectFirestoreEmulator,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  orderBy,
  query,
} from 'firebase/firestore';
import { connectFunctionsEmulator, getFunctions, httpsCallable } from 'firebase/functions';

import { requireFullEmulatorEnvironment } from '../local-emulator-environment.mjs';

const reportPath = process.env.TONIGHT_REPAIR_CHECK_OUTPUT ?? '';
const outputPath = process.env.TONIGHT_GO_NO_GO_OUTPUT ?? '';
const candidateManifestPath = process.env.EVENT_NIGHT_CANDIDATE_MANIFEST ?? '';
const sourcePath = path.resolve('.local-data/v1-export/library.json');

function keysDeep(value) {
  if (Array.isArray(value)) return value.flatMap(keysDeep);
  if (value === null || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, nested]) => [key, ...keysDeep(nested)]);
}

function assertPublicSafe(value, answerRevealed) {
  const keys = keysDeep(value);
  for (const forbidden of ['correctAnswer', 'correct', 'moderatorNote', 'legacy', 'raw']) {
    if (keys.includes(forbidden)) throw new Error(`Public state contains forbidden key ${forbidden}.`);
  }
  if (value.answerRevealed !== answerRevealed || Object.hasOwn(value, 'revealedAnswer') !== answerRevealed) {
    throw new Error('Public answer authority is inconsistent.');
  }
}

async function inventory(db) {
  const quizzes = await getDocs(collection(db, 'quizzes'));
  let slides = 0;
  let rounds = 0;
  let questions = 0;
  let correctAnswers = 0;
  let mediaReferences = 0;
  let legacyRawSlides = 0;
  const candidateSlides = [];
  for (const quiz of quizzes.docs) {
    const slideDocs = await getDocs(query(collection(quiz.ref, 'slides'), orderBy('position')));
    const roundDocs = await getDocs(query(collection(quiz.ref, 'rounds'), orderBy('position')));
    slides += slideDocs.size;
    rounds += roundDocs.size;
    for (const slide of slideDocs.docs) {
      const data = slide.data();
      if (data.isQuestion === true) {
        questions += 1;
        if (Object.hasOwn(data, 'correctAnswer')) correctAnswers += 1;
      }
      if (Array.isArray(data.media)) mediaReferences += data.media.length;
      if (data.legacy?.raw !== undefined) legacyRawSlides += 1;
      candidateSlides.push({ quizId: quiz.id, id: slide.id, data });
    }
  }
  return {
    summary: { quizzes: quizzes.size, slides, rounds, questions, correctAnswers, mediaReferences, legacyRawSlides },
    candidateSlides,
  };
}

async function publicState(db, sessionId) {
  const snapshot = await getDoc(doc(db, 'publicSessions', sessionId));
  if (!snapshot.exists()) throw new Error('Public projector state is missing.');
  return snapshot.data();
}

async function expectPrivateReadDenied(db, quizId) {
  try {
    await getDoc(doc(db, 'quizzes', quizId));
  } catch (error) {
    if (error?.code === 'permission-denied') return;
    throw error;
  }
  throw new Error('Anonymous client unexpectedly read a private quiz.');
}

async function runLiveSmoke({ functions, projectorDb, quizId, slides }) {
  const invoke = async (name, data) => (await httpsCallable(functions, name)(data)).data;
  let control = await invoke('createLiveSession', { quizId });
  const sessionId = control.sessionId;
  control = await invoke('nextSlide', { sessionId, expectedRevision: control.revision });
  control = await invoke('nextSlide', { sessionId, expectedRevision: control.revision });
  control = await invoke('previousSlide', { sessionId, expectedRevision: control.revision });
  assertPublicSafe(await publicState(projectorDb, sessionId), false);

  const audio = slides.find((slide) => ['audio', 'music'].includes(String(slide.data.kind)) && slide.data.isQuestion === true);
  const video = slides.find((slide) => ['video', 'youtube'].includes(String(slide.data.kind)) && slide.data.isQuestion === true);
  const recap = slides.find((slide) => slide.data.kind === 'recap');
  const question = slides.find((slide) => slide.data.isQuestion === true);
  if (!audio || !video || !recap || !question) throw new Error('Candidate lacks an AUDIO, VIDEO, RECAP, or question integration boundary.');

  control = await invoke('goToSlide', { sessionId, expectedRevision: control.revision, position: audio.data.position });
  const audioPublic = await publicState(projectorDb, sessionId);
  assertPublicSafe(audioPublic, false);
  if (Object.hasOwn(audioPublic, 'mediaSource')) throw new Error('Question-mode AUDIO source was published.');
  control = await invoke('playMedia', { sessionId, expectedRevision: control.revision });
  control = await invoke('stopMedia', { sessionId, expectedRevision: control.revision });

  control = await invoke('goToSlide', { sessionId, expectedRevision: control.revision, position: video.data.position });
  assertPublicSafe(await publicState(projectorDb, sessionId), false);
  control = await invoke('playMedia', { sessionId, expectedRevision: control.revision });
  control = await invoke('stopMedia', { sessionId, expectedRevision: control.revision });

  control = await invoke('goToSlide', { sessionId, expectedRevision: control.revision, position: recap.data.position });
  control = await invoke('selectRecapQuestion', {
    sessionId, expectedRevision: control.revision, position: question.data.position,
  });
  assertPublicSafe(await publicState(projectorDb, sessionId), false);
  control = await invoke('revealAnswer', { sessionId, expectedRevision: control.revision });
  assertPublicSafe(await publicState(projectorDb, sessionId), true);
  control = await invoke('hideAnswer', { sessionId, expectedRevision: control.revision });
  assertPublicSafe(await publicState(projectorDb, sessionId), false);
  await invoke('endLiveSession', { sessionId, expectedRevision: control.revision });
  return { created: true, nextPrevious: true, audioBoundary: true, videoBoundary: true, recapAuthority: true };
}

async function main() {
  const { projectId, authEndpoint, firestoreEndpoint, functionsEndpoint } = requireFullEmulatorEnvironment(
    process.env,
    'Tonight go/no-go verifier',
  );
  if (projectId !== 'demo-filmovy-kviz-v2' || !reportPath || !outputPath || !candidateManifestPath) {
    throw new Error('Tonight verifier is not pinned to its demo project and local reports.');
  }
  const [repairReport, candidateManifest, sourceBytes] = await Promise.all([
    readFile(reportPath, 'utf8').then(JSON.parse),
    readFile(candidateManifestPath, 'utf8').then(JSON.parse),
    readFile(sourcePath),
  ]);
  if (repairReport.projectId !== projectId || candidateManifest.projectId !== projectId
    || repairReport.candidate.quizId !== candidateManifest.candidate.quizId) {
    throw new Error('Candidate reports do not agree on the demo project and quiz.');
  }
  const sourceUnchanged = createHash('sha256').update(sourceBytes).digest('hex') === candidateManifest.sourceSha256;
  if (!sourceUnchanged) throw new Error('Read-only V1 source hash changed.');

  const firebaseOptions = { apiKey: 'demo-api-key', authDomain: `${projectId}.firebaseapp.com`, projectId, appId: '1:123:web:tonight-go-no-go' };
  const staffApp = initializeApp(firebaseOptions, 'tonight-go-no-go-staff');
  const projectorApp = initializeApp(firebaseOptions, 'tonight-go-no-go-projector');
  const auth = getAuth(staffApp);
  const functions = getFunctions(staffApp, 'europe-west1');
  const staffDb = getFirestore(staffApp);
  const projectorDb = getFirestore(projectorApp);
  connectAuthEmulator(auth, `http://${authEndpoint.host}:${authEndpoint.port}`, { disableWarnings: true });
  connectFunctionsEmulator(functions, functionsEndpoint.host, functionsEndpoint.port);
  connectFirestoreEmulator(staffDb, firestoreEndpoint.host, firestoreEndpoint.port);
  connectFirestoreEmulator(projectorDb, firestoreEndpoint.host, firestoreEndpoint.port);
  await expectPrivateReadDenied(projectorDb, repairReport.candidate.quizId);
  await signInWithEmailAndPassword(auth, 'admin@example.test', 'LocalQuiz123!');
  const { summary, candidateSlides } = await inventory(staffDb);
  const expectedInventory = { quizzes: 4, slides: 315, rounds: 23, questions: 263, correctAnswers: 263, mediaReferences: 154 };
  for (const [field, expected] of Object.entries(expectedInventory)) {
    if (summary[field] !== expected) throw new Error(`Migration inventory mismatch for ${field}.`);
  }
  if (summary.legacyRawSlides !== 315) throw new Error('Lossless legacy.raw inventory is incomplete.');

  let liveSmoke = { created: false, nextPrevious: false, audioBoundary: false, videoBoundary: false, recapAuthority: false };
  if (repairReport.readiness.blockers === 0) {
    liveSmoke = await runLiveSmoke({
      functions,
      projectorDb,
      quizId: repairReport.candidate.quizId,
      slides: candidateSlides.filter((slide) => slide.quizId === repairReport.candidate.quizId),
    });
  }
  const report = {
    schemaVersion: 1,
    projectId,
    checkedAtUtc: new Date().toISOString(),
    candidate: { quizId: repairReport.candidate.quizId, title: repairReport.candidate.title },
    readiness: repairReport.readiness,
    verdict: repairReport.readiness.blockers === 0 ? 'V2_OBSAHOVE_PRIPRAVENA' : 'V2_NENI_PRIPRAVENA',
    inventory: summary,
    sourceUnchanged,
    privateQuizAnonymousReadDenied: true,
    liveSmoke,
    physicalQaStillRequired: ['HDMI', 'physical-audio', 'fullscreen', 'real-audio', 'real-video', 'recap'],
    containsQuestionText: false,
    containsOptionValues: false,
    containsCorrectAnswers: false,
    containsMediaUrls: false,
    containsLegacyRaw: false,
  };
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ status: 'PASS', verdict: report.verdict, blockers: repairReport.readiness.blockers, output: '.local-data/tonight-repair/go-no-go-report.json' }));
  await Promise.all([deleteApp(staffApp), deleteApp(projectorApp)]);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
