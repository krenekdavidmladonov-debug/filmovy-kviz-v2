import { strict as assert } from 'node:assert';

import { deleteApp, initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import {
  collection, connectFirestoreEmulator, doc, getDoc, getDocs, getFirestore, orderBy, query,
} from 'firebase/firestore';
import { connectFunctionsEmulator, getFunctions, httpsCallable } from 'firebase/functions';

const projectId = globalThis.process.env.GCLOUD_PROJECT ?? globalThis.process.env.GOOGLE_CLOUD_PROJECT;
if (!projectId?.startsWith('demo-')) throw new Error('Migrated editor E2E requires a demo-* project ID.');

function localEndpoint(value, label) {
  const match = /^(127\.0\.0\.1|localhost):(\d+)$/u.exec(value ?? '');
  if (!match) throw new Error(`Migrated editor E2E requires the local ${label} Emulator.`);
  return { host: match[1], port: Number(match[2]) };
}

const firestoreEndpoint = localEndpoint(globalThis.process.env.FIRESTORE_EMULATOR_HOST, 'Firestore');
const authEndpoint = localEndpoint(globalThis.process.env.FIREBASE_AUTH_EMULATOR_HOST, 'Authentication');
const functionsEndpoint = localEndpoint(globalThis.process.env.FUNCTIONS_EMULATOR_HOST, 'Functions');

const app = initializeApp({
  apiKey: 'demo-api-key', authDomain: `${projectId}.firebaseapp.com`, projectId,
  appId: '1:123:web:quiz-editor-migrated-e2e',
}, 'quiz-editor-migrated-e2e');
const auth = getAuth(app);
const db = getFirestore(app);
const functions = getFunctions(app, 'europe-west1');
connectAuthEmulator(auth, `http://${authEndpoint.host}:${authEndpoint.port}`, { disableWarnings: true });
connectFirestoreEmulator(db, firestoreEndpoint.host, firestoreEndpoint.port);
connectFunctionsEmulator(functions, functionsEndpoint.host, functionsEndpoint.port);

const supportedKinds = new Set([
  'intro', 'agenda', 'rules', 'recap', 'end', 'title', 'info', 'round', 'roundheader', 'round-header', 'section',
  'question', 'text', 'classic', 'free', 'image', 'picture', 'photo',
  'audio', 'music', 'video', 'youtube', 'pl', 'legacy',
]);
const mediaRoles = new Set(['prompt', 'answer', 'background', 'unknown']);
const mediaKinds = new Set(['image', 'audio', 'video', 'unknown']);

function nullableNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function editorPayload(data) {
  assert.equal(typeof data.kind, 'string');
  assert.equal(supportedKinds.has(data.kind), true);
  assert.equal(typeof data.title, 'string');
  assert.equal(typeof data.text, 'string');
  assert.equal(Array.isArray(data.options), true);
  assert.equal(data.options.every((value) => typeof value === 'string'), true);
  const presentation = data.presentation && typeof data.presentation === 'object' ? data.presentation : {};
  const media = Array.isArray(data.media) ? data.media.map((item, sourceIndex) => {
    assert.equal(item !== null && typeof item === 'object' && !Array.isArray(item), true);
    assert.equal(mediaRoles.has(item.role), true);
    assert.equal(mediaKinds.has(item.kind), true);
    assert.equal(typeof item.value, 'string');
    return { sourceIndex, role: item.role, kind: item.kind, source: item.value };
  }) : [];
  return {
    kind: data.kind,
    title: data.title,
    text: data.text,
    moderatorNote: typeof data.moderatorNote === 'string' ? data.moderatorNote : '',
    options: data.options,
    correctAnswer: typeof data.correctAnswer === 'string' ? data.correctAnswer : '',
    media,
    presentation: {
      videoStart: nullableNumber(presentation.videoStart),
      videoEnd: nullableNumber(presentation.videoEnd),
      audioTrigger: nullableNumber(presentation.audioTrigger),
      backgroundOverlay: nullableNumber(presentation.backgroundOverlay),
      answerOverlay: nullableNumber(presentation.answerOverlay),
      sourceQuestionNumber: typeof presentation.sourceQuestionNumber === 'string' ? presentation.sourceQuestionNumber : null,
    },
    backgroundImage: typeof data.backgroundImage === 'string' ? data.backgroundImage : '',
    questionImage: typeof data.questionImage === 'string' ? data.questionImage : '',
    answerImage: typeof data.answerImage === 'string' ? data.answerImage : '',
    mediaSource: typeof data.mediaSource === 'string' ? data.mediaSource : '',
    backgroundOverlay: nullableNumber(data.backgroundOverlay),
    clipStartSeconds: nullableNumber(data.clipStartSeconds),
    clipEndSeconds: nullableNumber(data.clipEndSeconds),
  };
}

async function run() {
  await signInWithEmailAndPassword(auth, 'admin@example.test', 'LocalQuiz123!');
  const quizDocuments = (await getDocs(collection(db, 'quizzes'))).docs;
  assert.equal(quizDocuments.length, 4);
  let totalSlides = 0;
  const representatives = new Map();
  const revisions = new Map();

  for (const quizDocument of quizDocuments) {
    const quiz = quizDocument.data();
    assert.equal(typeof quiz.title, 'string');
    assert.equal(typeof quiz.description, 'string');
    const slideDocuments = (await getDocs(query(collection(quizDocument.ref, 'slides'), orderBy('position')))).docs;
    assert.equal(slideDocuments.length, quiz.slideCount);
    slideDocuments.forEach((slideDocument, index) => {
      const data = slideDocument.data();
      assert.equal(data.position, index + 1);
      editorPayload(data);
      if (!representatives.has(data.kind)) {
        representatives.set(data.kind, { quizId: quizDocument.id, slideId: slideDocument.id, before: data });
      }
    });
    totalSlides += slideDocuments.length;
    revisions.set(quizDocument.id, Number.isInteger(quiz.revision) ? quiz.revision : 0);
  }
  assert.equal(totalSlides, 315);

  for (const representative of representatives.values()) {
    const revision = revisions.get(representative.quizId);
    const response = (await httpsCallable(functions, 'updateQuizSlide')({
      quizId: representative.quizId,
      slideId: representative.slideId,
      expectedRevision: revision,
      slide: editorPayload(representative.before),
    })).data;
    revisions.set(representative.quizId, response.revision);
    const after = (await getDoc(doc(db, 'quizzes', representative.quizId, 'slides', representative.slideId))).data();
    assert.deepEqual(after, representative.before);
  }

  assert.deepEqual([...representatives.keys()].sort(), [
    'agenda', 'audio', 'end', 'free', 'image', 'intro', 'pl', 'question', 'recap', 'video',
  ]);
  globalThis.console.log(JSON.stringify({
    status: 'PASS', quizzesOpened: quizDocuments.length, slidesOpened: totalSlides,
    slideKindsOpened: representatives.size, representativeRoundTrips: representatives.size,
    legacyRawPreserved: true, privateValuesPrinted: false,
  }, null, 2));
}

try {
  await run();
} finally {
  await deleteApp(app);
}
