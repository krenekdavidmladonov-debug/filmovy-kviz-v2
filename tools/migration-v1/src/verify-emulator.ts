import { isDeepStrictEqual } from 'node:util';
import path from 'node:path';

import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

import { MigrationValidationError } from './errors.js';
import { normalizeV1Library } from './normalize.js';
import { readV1Library } from './read.js';
import { transformLibrary } from './transform.js';
import type { V2QuizDocument } from './types.js';
import { calculateOutputStats, validateNormalizedInput, validateOutput } from './validate.js';
import { assertSafeEmulatorEnvironment } from './write.js';

const inputPath = path.resolve('.local-data/v1-export/library.json');

function assertEqual(actual: unknown, expected: unknown, message: string): void {
  if (!isDeepStrictEqual(actual, expected)) throw new MigrationValidationError(message);
}

async function verifyQuiz(db: FirebaseFirestore.Firestore, expected: V2QuizDocument): Promise<void> {
  const quizRef = db.collection('quizzes').doc(expected.id);
  const quizSnapshot = await quizRef.get();
  if (!quizSnapshot.exists) throw new MigrationValidationError(`Missing migrated quiz ${expected.id}.`);
  const quizData = quizSnapshot.data()!;
  assertEqual(quizData.slideCount, expected.slides.length, `Quiz ${expected.id}: slideCount mismatch in emulator.`);
  assertEqual(quizData.roundCount, expected.rounds.length, `Quiz ${expected.id}: roundCount mismatch in emulator.`);
  assertEqual(
    quizData.questionCount,
    expected.rounds.reduce((total, round) => total + round.questions.length, 0),
    `Quiz ${expected.id}: questionCount mismatch in emulator.`,
  );

  const actualSlides = await quizRef.collection('slides').orderBy('position').get();
  assertEqual(actualSlides.size, expected.slides.length, `Quiz ${expected.id}: slide document count mismatch.`);
  expected.slides.forEach((expectedSlide, index) => {
    const actualSlide = actualSlides.docs[index];
    if (actualSlide === undefined) throw new MigrationValidationError(`Quiz ${expected.id}: missing slide ${index + 1}.`);
    const actualData = actualSlide.data();
    assertEqual(actualSlide.id, expectedSlide.id, `Quiz ${expected.id}: slide order/id mismatch at ${index + 1}.`);
    assertEqual(actualData.position, expectedSlide.data.position, `Quiz ${expected.id}: slide position mismatch at ${index + 1}.`);
    assertEqual(actualData.roundId, expectedSlide.data.roundId, `Quiz ${expected.id}: slide round assignment mismatch at ${index + 1}.`);
    assertEqual(actualData.correctAnswer, expectedSlide.data.correctAnswer, `Quiz ${expected.id}: private answer mismatch at slide ${index + 1}.`);
    assertEqual(actualData.media, expectedSlide.data.media, `Quiz ${expected.id}: media mismatch at slide ${index + 1}.`);
  });

  const actualRounds = await quizRef.collection('rounds').orderBy('position').get();
  assertEqual(actualRounds.size, expected.rounds.length, `Quiz ${expected.id}: round document count mismatch.`);
  for (const [roundIndex, expectedRound] of expected.rounds.entries()) {
    const actualRound = actualRounds.docs[roundIndex];
    if (actualRound === undefined) throw new MigrationValidationError(`Quiz ${expected.id}: missing round ${roundIndex + 1}.`);
    assertEqual(actualRound.id, expectedRound.id, `Quiz ${expected.id}: round order/id mismatch at ${roundIndex + 1}.`);
    const actualQuestions = await actualRound.ref.collection('questions').orderBy('position').get();
    assertEqual(actualQuestions.size, expectedRound.questions.length, `Quiz ${expected.id}: question count mismatch in round ${roundIndex + 1}.`);
    expectedRound.questions.forEach((expectedQuestion, questionIndex) => {
      const actualQuestion = actualQuestions.docs[questionIndex];
      if (actualQuestion === undefined) {
        throw new MigrationValidationError(`Quiz ${expected.id}: missing question ${questionIndex + 1} in round ${roundIndex + 1}.`);
      }
      const actualData = actualQuestion.data();
      assertEqual(actualQuestion.id, expectedQuestion.id, `Quiz ${expected.id}: question order/id mismatch.`);
      assertEqual(actualData.sourceSlidePosition, expectedQuestion.data.sourceSlidePosition, `Quiz ${expected.id}: question source position mismatch.`);
      assertEqual(actualData.correctAnswer, expectedQuestion.data.correctAnswer, `Quiz ${expected.id}: private question answer mismatch.`);
      assertEqual(actualData.media, expectedQuestion.data.media, `Quiz ${expected.id}: question media mismatch.`);
    });
  }
}

async function verifyEmulator(): Promise<void> {
  const { projectId } = assertSafeEmulatorEnvironment();
  const source = normalizeV1Library(await readV1Library(inputPath));
  validateNormalizedInput(source);
  const expected = transformLibrary(source, new Date(0));
  validateOutput(source, expected);
  const app = initializeApp({ projectId }, `migration-v1-verify-${Date.now()}`);
  try {
    const db = getFirestore(app);
    const actualQuizIds = (await db.collection('quizzes').get()).docs.map((document) => document.id).sort();
    assertEqual(actualQuizIds, expected.map((quiz) => quiz.id).sort(), 'Emulator quiz id set does not match migration input.');
    for (const quiz of expected) await verifyQuiz(db, quiz);
    const totals = calculateOutputStats(expected);
    console.log(JSON.stringify({
      status: 'PASS',
      projectId,
      ...totals,
      correctAnswersVerified: totals.correctAnswers,
      mediaReferencesVerified: totals.images + totals.audio + totals.video,
    }, null, 2));
  } finally {
    await deleteApp(app);
  }
}

void verifyEmulator().catch((error: unknown) => {
  const name = error instanceof Error ? error.name : 'Error';
  const message = error instanceof Error ? error.message : 'Unknown emulator verification failure.';
  console.error(JSON.stringify({ status: 'FAILED', error: name, message }, null, 2));
  process.exitCode = 1;
});
