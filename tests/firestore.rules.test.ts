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
  test('can read administrative quiz data', async () => {
    const db = testEnvironment
      .authenticatedContext('moderator-user', { role: 'moderator' })
      .firestore();
    await assertSucceeds(getDoc(doc(db, privateQuizPath)));
  });

  test('cannot perform an admin-only write', async () => {
    const db = testEnvironment
      .authenticatedContext('moderator-user', { role: 'moderator' })
      .firestore();
    await assertFails(setDoc(doc(db, 'quizzes/moderator-write'), { title: 'Denied' }));
  });
});

describe('admin', () => {
  test('can read administrative quiz data', async () => {
    const db = testEnvironment
      .authenticatedContext('admin-user', { role: 'admin' })
      .firestore();
    await assertSucceeds(getDoc(doc(db, privateQuizPath)));
  });

  test('can write administrative quiz data', async () => {
    const db = testEnvironment
      .authenticatedContext('admin-user', { role: 'admin' })
      .firestore();
    await assertSucceeds(setDoc(doc(db, 'quizzes/admin-write'), { title: 'Allowed' }));
  });
});

test('an unknown path remains denied even for an admin', async () => {
  const db = testEnvironment
    .authenticatedContext('admin-user', { role: 'admin' })
    .firestore();
  await assertFails(getDoc(doc(db, 'unknown/private-document')));
});
