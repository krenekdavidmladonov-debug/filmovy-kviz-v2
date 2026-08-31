import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { afterAll, afterEach, beforeAll, beforeEach, describe, test } from 'vitest';

const projectId = 'demo-filmovy-kviz-v2';
const privateQuizPath = 'quizzes/security-test-quiz';
const privateRoundPath = `${privateQuizPath}/rounds/security-test-round`;
const privateQuestionPath = `${privateRoundPath}/questions/security-test-question`;

let testEnvironment: RulesTestEnvironment;

beforeAll(async () => {
  testEnvironment = await initializeTestEnvironment({
    projectId,
    firestore: {
      rules: readFileSync(resolve(process.cwd(), 'firestore.rules'), 'utf8'),
    },
  });
});

beforeEach(async () => {
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), privateQuizPath), {
      title: 'Security test quiz',
      status: 'draft',
    });
    await setDoc(doc(context.firestore(), privateRoundPath), {
      title: 'Security test round',
      position: 1,
    });
    await setDoc(doc(context.firestore(), privateQuestionPath), {
      prompt: 'Private question',
      correctAnswer: 'Private answer',
      position: 1,
    });
  });
});

afterEach(async () => {
  await testEnvironment.clearFirestore();
});

afterAll(async () => {
  await testEnvironment.cleanup();
});

describe('anonymous user', () => {
  test('cannot read private data', async () => {
    const db = testEnvironment.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, privateQuizPath)));
  });

  test('cannot write private data', async () => {
    const db = testEnvironment.unauthenticatedContext().firestore();
    await assertFails(setDoc(doc(db, 'quizzes/anonymous-write'), { title: 'Denied' }));
  });
});

describe('authenticated user without a role', () => {
  test('cannot read private data', async () => {
    const db = testEnvironment.authenticatedContext('regular-user').firestore();
    await assertFails(getDoc(doc(db, privateQuizPath)));
  });

  test('cannot write private data', async () => {
    const db = testEnvironment.authenticatedContext('regular-user').firestore();
    await assertFails(setDoc(doc(db, 'quizzes/user-write'), { title: 'Denied' }));
  });
});

describe('moderator', () => {
  test('can read a quiz document', async () => {
    const db = testEnvironment
      .authenticatedContext('moderator-user', { role: 'moderator' })
      .firestore();
    await assertSucceeds(getDoc(doc(db, privateQuizPath)));
  });

  test('can read a round document', async () => {
    const db = testEnvironment
      .authenticatedContext('moderator-user', { role: 'moderator' })
      .firestore();
    await assertSucceeds(getDoc(doc(db, privateRoundPath)));
  });

  test('can read a private question document', async () => {
    const db = testEnvironment
      .authenticatedContext('moderator-user', { role: 'moderator' })
      .firestore();
    await assertSucceeds(getDoc(doc(db, privateQuestionPath)));
  });

  test('cannot write a quiz', async () => {
    const db = testEnvironment
      .authenticatedContext('moderator-user', { role: 'moderator' })
      .firestore();
    await assertFails(setDoc(doc(db, 'quizzes/moderator-write'), { title: 'Denied' }));
  });
});

describe('admin', () => {
  test('can read a quiz document', async () => {
    const db = testEnvironment
      .authenticatedContext('admin-user', { role: 'admin' })
      .firestore();
    await assertSucceeds(getDoc(doc(db, privateQuizPath)));
  });

  test('cannot write a quiz in the read-only phase', async () => {
    const db = testEnvironment
      .authenticatedContext('admin-user', { role: 'admin' })
      .firestore();
    await assertFails(setDoc(doc(db, 'quizzes/admin-write'), { title: 'Denied' }));
  });
});

test('an unknown path remains denied even for an admin', async () => {
  const db = testEnvironment
    .authenticatedContext('admin-user', { role: 'admin' })
    .firestore();
  await assertFails(getDoc(doc(db, 'unknown/private-document')));
});
