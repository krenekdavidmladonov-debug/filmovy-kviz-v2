import { strict as assert } from 'node:assert';

import { deleteApp, initializeApp } from 'firebase/app';
import {
  connectAuthEmulator,
  getAuth,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth';
import {
  collection,
  connectFirestoreEmulator,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  orderBy,
  query,
  updateDoc,
} from 'firebase/firestore';
import {
  connectFunctionsEmulator,
  getFunctions,
  httpsCallable,
} from 'firebase/functions';
import { requireFullEmulatorEnvironment } from '../../tools/local-emulator-environment.mjs';

const { projectId, authEndpoint, firestoreEndpoint, functionsEndpoint } = requireFullEmulatorEnvironment(
  globalThis.process.env,
  'Editor E2E',
);

const app = initializeApp({
  apiKey: 'demo-api-key', authDomain: `${projectId}.firebaseapp.com`, projectId,
  appId: '1:123:web:quiz-editor-e2e',
}, 'quiz-editor-e2e');
const auth = getAuth(app);
const db = getFirestore(app);
const functions = getFunctions(app, 'europe-west1');
connectAuthEmulator(auth, `http://${authEndpoint.host}:${authEndpoint.port}`, { disableWarnings: true });
connectFirestoreEmulator(db, firestoreEndpoint.host, firestoreEndpoint.port);
connectFunctionsEmulator(functions, functionsEndpoint.host, functionsEndpoint.port);

const quizId = 'quiz-editor-e2e';
const quizRef = doc(db, 'quizzes', quizId);
const slideRef = (id) => doc(db, 'quizzes', quizId, 'slides', id);
const invoke = async (name, data) => (await httpsCallable(functions, name)(data)).data;

async function expectFunctionError(action, code) {
  try {
    await action();
    assert.fail(`Expected ${code}.`);
  } catch (error) {
    assert.equal(error.code, code);
  }
}

function editorSlide(overrides = {}) {
  return {
    kind: 'question', title: 'Syntetický slide', text: 'Syntetické zadání',
    moderatorNote: 'Soukromá syntetická poznámka',
    options: ['A', 'B', 'C', 'D'], correctAnswer: 'Syntetická správná odpověď',
    media: [],
    presentation: {
      videoStart: null, videoEnd: null, audioTrigger: null,
      backgroundOverlay: null, answerOverlay: null, sourceQuestionNumber: null,
    },
    ...overrides,
  };
}

async function orderedSlides() {
  return (await getDocs(query(collection(quizRef, 'slides'), orderBy('position')))).docs;
}

async function run() {
  await expectFunctionError(
    () => invoke('updateQuizMetadata', { quizId, expectedRevision: 0, quiz: { title: 'Denied', description: '' } }),
    'functions/unauthenticated',
  );
  await expectFunctionError(
    () => invoke('repairQuizPreflightIssue', {
      quizId, slideId: 'slide-002', expectedRevision: 0, kind: 'choice-answer', optionIndex: 0,
    }),
    'functions/unauthenticated',
  );

  await signInWithEmailAndPassword(auth, 'user@example.test', 'LocalQuiz123!');
  await expectFunctionError(
    () => invoke('updateQuizMetadata', { quizId, expectedRevision: 0, quiz: { title: 'Denied', description: '' } }),
    'functions/permission-denied',
  );
  await signOut(auth);

  await signInWithEmailAndPassword(auth, 'moderator@example.test', 'LocalQuiz123!');
  assert.equal((await getDoc(quizRef)).exists(), true);
  assert.equal((await getDoc(slideRef('slide-002'))).exists(), true);
  await expectFunctionError(
    () => invoke('updateQuizSlide', { quizId, slideId: 'slide-002', expectedRevision: 0, slide: editorSlide() }),
    'functions/permission-denied',
  );
  await expectFunctionError(
    () => invoke('repairQuizPreflightIssue', {
      quizId, slideId: 'slide-002', expectedRevision: 0, kind: 'choice-answer', optionIndex: 0,
    }),
    'functions/permission-denied',
  );
  await signOut(auth);

  await signInWithEmailAndPassword(auth, 'admin@example.test', 'LocalQuiz123!');
  await assert.rejects(updateDoc(quizRef, { title: 'Direct write must fail' }), /permission-denied/u);
  const publicBefore = await getDoc(doc(db, 'publicSessions', 'quiz-editor-e2e'));
  assert.equal(publicBefore.exists(), false);

  const originalSlide = (await getDoc(slideRef('slide-002'))).data();
  const originalLegacy = JSON.parse(JSON.stringify(originalSlide.legacy));
  const updated = await invoke('updateQuizSlide', {
    quizId, slideId: 'slide-002', expectedRevision: 0,
    slide: editorSlide({
      title: 'Upravený syntetický slide',
      options: ['A', 'B', 'C', 'D', 'E'],
      media: [
        { sourceIndex: 0, role: 'prompt', kind: 'image', source: 'https://example.test/replaced.jpg' },
        { sourceIndex: 1, role: 'answer', kind: 'image', source: 'https://example.test/answer-replaced.jpg' },
        { role: 'prompt', kind: 'audio', source: 'synthetic-audio-reference' },
      ],
      presentation: {
        videoStart: 2, videoEnd: 8, audioTrigger: 1,
        backgroundOverlay: 55, answerOverlay: 20, sourceQuestionNumber: '2/9',
      },
    }),
  });
  assert.equal(updated.revision, 1);
  const storedUpdated = (await getDoc(slideRef('slide-002'))).data();
  assert.deepEqual(storedUpdated.legacy, originalLegacy);
  assert.equal(storedUpdated.options.length, 5);
  assert.equal(storedUpdated.media.length, 3);

  await expectFunctionError(
    () => invoke('updateQuizSlide', { quizId, slideId: 'slide-002', expectedRevision: 0, slide: editorSlide() }),
    'functions/aborted',
  );

  const duplicateRace = await Promise.allSettled([
    invoke('duplicateQuizSlide', { quizId, slideId: 'slide-002', expectedRevision: 1 }),
    invoke('duplicateQuizSlide', { quizId, slideId: 'slide-002', expectedRevision: 1 }),
  ]);
  assert.equal(duplicateRace.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(duplicateRace.filter((result) => result.status === 'rejected').length, 1);
  const duplicateResult = duplicateRace.find((result) => result.status === 'fulfilled').value;
  const duplicateId = duplicateResult.selectedSlideId;
  assert.equal(duplicateResult.revision, 2);

  const moved = await invoke('moveQuizSlide', {
    quizId, slideId: duplicateId, direction: 1, expectedRevision: 2,
  });
  assert.equal(moved.revision, 3);

  const beforeRoundCount = moved.roundCount;
  const createdRound = await invoke('createQuizSlide', {
    quizId, expectedRevision: 3, position: moved.slideCount + 1,
    slide: editorSlide({ kind: 'round', title: 'Syntetické nové kolo', moderatorNote: '', correctAnswer: '', options: [] }),
  });
  assert.equal(createdRound.roundCount, beforeRoundCount + 1);
  const roundHeader = (await getDoc(slideRef(createdRound.selectedSlideId))).data();
  assert.equal(typeof roundHeader.roundId, 'string');

  const createdQuestion = await invoke('createQuizSlide', {
    quizId, expectedRevision: 4, position: createdRound.slideCount + 1,
    slide: editorSlide({
      kind: 'video', options: ['1', '2', '3', '4', '5', '6'],
      media: [
        { role: 'prompt', kind: 'video', source: 'https://example.test/video' },
        { role: 'background', kind: 'image', source: 'https://example.test/background.jpg' },
      ],
      presentation: { videoStart: 3, videoEnd: 12, audioTrigger: null, backgroundOverlay: 40, answerOverlay: null, sourceQuestionNumber: null },
    }),
  });
  assert.equal(createdQuestion.questionCount, updated.questionCount + 2);
  const derivedQuestion = await getDoc(doc(db, 'quizzes', quizId, 'rounds', roundHeader.roundId, 'questions', createdQuestion.selectedSlideId));
  assert.equal(derivedQuestion.exists(), true);
  assert.equal(derivedQuestion.data().options.length, 6);

  const deleted = await invoke('deleteQuizSlide', {
    quizId, slideId: duplicateId, expectedRevision: 5,
  });
  assert.equal(deleted.revision, 6);
  const finalSlides = await orderedSlides();
  assert.deepEqual(finalSlides.map((slide) => slide.data().position), Array.from({ length: finalSlides.length }, (_, index) => index + 1));
  assert.equal((await getDoc(slideRef(duplicateId))).exists(), false);
  assert.deepEqual((await getDoc(slideRef('slide-002'))).data().legacy, originalLegacy);

  const implicitQuestion = await invoke('createQuizSlide', {
    quizId, expectedRevision: 6, position: 1,
    slide: editorSlide({ kind: 'free', title: 'Syntetická otázka bez předchozího kola' }),
  });
  const implicitSlide = (await getDoc(slideRef(implicitQuestion.selectedSlideId))).data();
  assert.equal(typeof implicitSlide.roundId, 'string');
  assert.equal((await getDoc(doc(db, 'quizzes', quizId, 'rounds', implicitSlide.roundId, 'questions', implicitQuestion.selectedSlideId))).exists(), true);
  const removedImplicitQuestion = await invoke('deleteQuizSlide', {
    quizId, slideId: implicitQuestion.selectedSlideId, expectedRevision: 7,
  });
  assert.equal(removedImplicitQuestion.revision, 8);
  assert.equal((await getDoc(doc(db, 'quizzes', quizId, 'rounds', implicitSlide.roundId))).exists(), false);

  const renamedRound = await invoke('updateQuizRound', {
    quizId, roundId: 'live-round', title: 'Přejmenované syntetické kolo', expectedRevision: 8,
  });
  assert.equal(renamedRound.revision, 9);
  assert.equal((await getDoc(doc(db, 'quizzes', quizId, 'rounds', 'live-round'))).data().title, 'Přejmenované syntetické kolo');

  const reorderedQuestion = await invoke('reorderQuizQuestion', {
    quizId, slideId: 'slide-002', direction: 1, expectedRevision: 9,
  });
  assert.equal(reorderedQuestion.revision, 10);
  const reorderedLiveQuestions = (await getDocs(query(collection(quizRef, 'slides'), orderBy('position')))).docs
    .filter((item) => item.data().roundId === 'live-round' && item.data().isQuestion === true);
  assert.equal(reorderedLiveQuestions[1].id, 'slide-002');

  const movedQuestion = await invoke('moveQuizQuestionToRound', {
    quizId, slideId: 'slide-002', targetRoundId: roundHeader.roundId, expectedRevision: 10,
  });
  assert.equal(movedQuestion.revision, 11);
  assert.equal((await getDoc(slideRef('slide-002'))).data().roundId, roundHeader.roundId);
  assert.equal((await getDoc(doc(db, 'quizzes', quizId, 'rounds', 'live-round', 'questions', 'slide-002'))).exists(), false);
  assert.equal((await getDoc(doc(db, 'quizzes', quizId, 'rounds', roundHeader.roundId, 'questions', 'slide-002'))).exists(), true);

  const duplicatedRound = await invoke('duplicateQuizRound', {
    quizId, roundId: 'live-round', expectedRevision: 11,
  });
  assert.equal(duplicatedRound.revision, 12);
  const duplicatedRoundId = (await getDoc(slideRef(duplicatedRound.selectedSlideId))).data().roundId;
  assert.notEqual(duplicatedRoundId, 'live-round');
  assert.notEqual(duplicatedRoundId, roundHeader.roundId);
  const duplicatedRoundSlides = (await getDocs(query(collection(quizRef, 'slides'), orderBy('position')))).docs
    .filter((item) => item.data().roundId === duplicatedRoundId);
  assert.equal(duplicatedRoundSlides.length > 0, true);
  assert.equal(duplicatedRoundSlides.every((item) => item.data().roundTitle.endsWith('– kopie')), true);

  const movedRound = await invoke('moveQuizRound', {
    quizId, roundId: duplicatedRoundId, direction: 1, expectedRevision: 12,
  });
  assert.equal(movedRound.revision, 13);
  const roundOrderAfterMove = (await getDocs(query(collection(quizRef, 'rounds'), orderBy('position')))).docs.map((item) => item.id);
  assert.deepEqual(roundOrderAfterMove, ['live-round', roundHeader.roundId, duplicatedRoundId]);

  const deletedRound = await invoke('removeQuizRound', {
    quizId, roundId: duplicatedRoundId, mode: 'delete', expectedRevision: 13,
  });
  assert.equal(deletedRound.revision, 14);
  assert.equal((await getDoc(doc(db, 'quizzes', quizId, 'rounds', duplicatedRoundId))).exists(), false);

  const removedRoundWithMove = await invoke('removeQuizRound', {
    quizId, roundId: roundHeader.roundId, mode: 'move', targetRoundId: 'live-round', expectedRevision: 14,
  });
  assert.equal(removedRoundWithMove.revision, 15);
  assert.equal((await getDoc(doc(db, 'quizzes', quizId, 'rounds', roundHeader.roundId))).exists(), false);
  assert.equal((await getDoc(slideRef('slide-002'))).data().roundId, 'live-round');

  await expectFunctionError(
    () => invoke('repairQuizPreflightIssue', {
      quizId, slideId: 'slide-002', expectedRevision: 15, kind: 'choice-answer', optionIndex: 99,
    }),
    'functions/invalid-argument',
  );
  const beforeRepair = (await getDoc(slideRef('slide-002'))).data();
  const selectedStoredOption = beforeRepair.options[4];
  const repairedChoice = await invoke('repairQuizPreflightIssue', {
    quizId, slideId: 'slide-002', expectedRevision: 15, kind: 'choice-answer', optionIndex: 4,
  });
  assert.equal(repairedChoice.revision, 16);
  assert.equal(JSON.stringify(repairedChoice).includes(selectedStoredOption), false);
  assert.equal(Object.hasOwn(repairedChoice, 'correctAnswer'), false);
  const afterChoiceRepair = (await getDoc(slideRef('slide-002'))).data();
  assert.equal(afterChoiceRepair.correctAnswer, selectedStoredOption);
  assert.deepEqual(afterChoiceRepair.legacy, originalLegacy);
  assert.equal(
    (await getDoc(doc(db, 'quizzes', quizId, 'rounds', 'live-round', 'questions', 'slide-002'))).data().correctAnswer,
    selectedStoredOption,
  );
  await expectFunctionError(
    () => invoke('repairQuizPreflightIssue', {
      quizId, slideId: 'slide-002', expectedRevision: 15, kind: 'choice-answer', optionIndex: 0,
    }),
    'functions/aborted',
  );
  await expectFunctionError(
    () => invoke('repairQuizPreflightIssue', {
      quizId, slideId: createdQuestion.selectedSlideId, expectedRevision: 16, kind: 'video-timing',
      clipStartSeconds: 12, clipEndSeconds: 12,
    }),
    'functions/invalid-argument',
  );
  const repairedTiming = await invoke('repairQuizPreflightIssue', {
    quizId, slideId: createdQuestion.selectedSlideId, expectedRevision: 16, kind: 'video-timing',
    clipStartSeconds: 4.5, clipEndSeconds: 11,
  });
  assert.equal(repairedTiming.revision, 17);
  assert.equal(Object.hasOwn(repairedTiming, 'clipStartSeconds'), false);
  const repairedVideoSlide = (await getDoc(slideRef(createdQuestion.selectedSlideId))).data();
  assert.deepEqual(
    { clipStartSeconds: repairedVideoSlide.clipStartSeconds, clipEndSeconds: repairedVideoSlide.clipEndSeconds },
    { clipStartSeconds: 4.5, clipEndSeconds: 11 },
  );

  const finalQuiz = (await getDoc(quizRef)).data();
  const finalOrderedSlides = await orderedSlides();
  assert.equal(finalQuiz.slideCount, finalOrderedSlides.length);
  assert.deepEqual(finalOrderedSlides.map((slide) => slide.data().position), Array.from({ length: finalOrderedSlides.length }, (_, index) => index + 1));
  assert.equal(finalQuiz.revision, 17);
  assert.equal((await getDoc(doc(db, 'publicSessions', 'quiz-editor-e2e'))).exists(), false);

  globalThis.console.log(JSON.stringify({
    status: 'PASS', adminMutations: true, moderatorReadOnly: true, normalUserDenied: true,
    directWritesDenied: true, staleAndConcurrentWritesVerified: true,
    legacyRoundTripPreserved: true, orderedCrudVerified: true,
    implicitRoundCreatedAndCleaned: true, semanticRoundAndQuestionOperationsVerified: true,
    guidedChoiceAndTimingRepairVerified: true, repairAuthorizationAndStaleRevisionVerified: true,
    repairResponseSanitized: true,
    safeRoundRemovalModesVerified: true, publicSessionUntouched: true,
  }, null, 2));
}

try {
  await run();
} finally {
  await deleteApp(app);
}
