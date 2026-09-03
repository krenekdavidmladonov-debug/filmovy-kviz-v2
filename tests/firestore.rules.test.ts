import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, setDoc } from 'firebase/firestore';
import { afterAll, afterEach, beforeAll, beforeEach, describe, test } from 'vitest';

const projectId = 'demo-filmovy-kviz-v2';
const privateQuizPath = 'quizzes/security-test-quiz';
const privateRoundPath = `${privateQuizPath}/rounds/security-test-round`;
const privateSlidePath = `${privateQuizPath}/slides/security-test-slide`;
const privateQuestionPath = `${privateRoundPath}/questions/security-test-question`;
const privateSessionPath = 'sessions/security-test-session';
const publicSessionPath = 'publicSessions/security-test-session';
const privateEventPath = 'events/security-test-event';
const privateEventChildPath = `${privateEventPath}/future/private-child`;
const privateSnapshotPath = 'quizSnapshots/security-test-snapshot';
const privateSnapshotSlidePath = `${privateSnapshotPath}/slides/security-test-slide`;
const publicEventPath = 'publicEvents/security-test-event';

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
    await setDoc(doc(context.firestore(), privateSlidePath), {
      position: 1,
      correctAnswer: 'Private slide answer',
    });
    await setDoc(doc(context.firestore(), privateQuestionPath), {
      prompt: 'Private question',
      correctAnswer: 'Private answer',
      position: 1,
    });
    await setDoc(doc(context.firestore(), privateSessionPath), {
      quizId: 'security-test-quiz',
      status: 'active',
      currentSlidePosition: 1,
      answerRevealed: false,
      revision: 1,
    });
    await setDoc(doc(context.firestore(), publicSessionPath), {
      sessionId: 'security-test-session',
      status: 'active',
      slidePosition: 1,
      answerRevealed: false,
      title: 'Public prompt',
    });
    await setDoc(doc(context.firestore(), privateEventPath), {
      title: 'Private event', revision: 1, lifecycleStatus: 'scheduled',
    });
    await setDoc(doc(context.firestore(), privateEventChildPath), { secret: true });
    await setDoc(doc(context.firestore(), privateSnapshotPath), {
      quizId: 'security-test-quiz', quizRevision: 1,
    });
    await setDoc(doc(context.firestore(), privateSnapshotSlidePath), {
      correctAnswer: 'Private snapshot answer',
    });
    await setDoc(doc(context.firestore(), publicEventPath), {
      title: 'Public event', registrationStatus: 'scheduled',
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
    await assertFails(getDoc(doc(db, privateSlidePath)));
    await assertFails(getDoc(doc(db, privateQuestionPath)));
    await assertFails(getDoc(doc(db, privateSessionPath)));
    await assertFails(getDoc(doc(db, privateEventPath)));
    await assertFails(getDoc(doc(db, privateSnapshotPath)));
    await assertFails(getDoc(doc(db, privateSnapshotSlidePath)));
  });

  test('cannot write private data', async () => {
    const db = testEnvironment.unauthenticatedContext().firestore();
    await assertFails(setDoc(doc(db, 'quizzes/anonymous-write'), { title: 'Denied' }));
    await assertFails(setDoc(doc(db, privateSessionPath), { status: 'ended' }));
  });

  test('can get one public session but cannot list or write public sessions', async () => {
    const db = testEnvironment.unauthenticatedContext().firestore();
    await assertSucceeds(getDoc(doc(db, publicSessionPath)));
    await assertFails(getDocs(collection(db, 'publicSessions')));
    await assertFails(setDoc(doc(db, publicSessionPath), { answerRevealed: true }));
  });

  test('can read and query public events but cannot write them', async () => {
    const db = testEnvironment.unauthenticatedContext().firestore();
    await assertSucceeds(getDoc(doc(db, publicEventPath)));
    await assertSucceeds(getDocs(collection(db, 'publicEvents')));
    await assertFails(setDoc(doc(db, publicEventPath), { title: 'Forged' }));
  });

  test('cannot read unknown private event subpaths', async () => {
    const db = testEnvironment.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, privateEventChildPath)));
  });
});

describe('authenticated user without a role', () => {
  test('cannot read private data', async () => {
    const db = testEnvironment.authenticatedContext('regular-user').firestore();
    await assertFails(getDoc(doc(db, privateQuizPath)));
    await assertFails(getDoc(doc(db, privateSlidePath)));
    await assertFails(getDoc(doc(db, privateSessionPath)));
    await assertFails(getDoc(doc(db, privateEventPath)));
    await assertFails(getDoc(doc(db, privateSnapshotPath)));
  });

  test('cannot write private data', async () => {
    const db = testEnvironment.authenticatedContext('regular-user').firestore();
    await assertFails(setDoc(doc(db, 'quizzes/user-write'), { title: 'Denied' }));
    await assertFails(setDoc(doc(db, privateSessionPath), { revision: 99 }));
    await assertFails(setDoc(doc(db, publicSessionPath), { answerRevealed: true }));
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

  test('can read a private source slide document', async () => {
    const db = testEnvironment
      .authenticatedContext('moderator-user', { role: 'moderator' })
      .firestore();
    await assertSucceeds(getDoc(doc(db, privateSlidePath)));
  });

  test('can read but cannot directly write private live sessions', async () => {
    const db = testEnvironment
      .authenticatedContext('moderator-user', { role: 'moderator' })
      .firestore();
    await assertSucceeds(getDoc(doc(db, privateSessionPath)));
    await assertFails(setDoc(doc(db, privateSessionPath), { status: 'ended' }));
  });

  test('cannot write a quiz', async () => {
    const db = testEnvironment
      .authenticatedContext('moderator-user', { role: 'moderator' })
      .firestore();
    await assertFails(setDoc(doc(db, 'quizzes/moderator-write'), { title: 'Denied' }));
  });

  test('can read an event root and private snapshot but cannot write or read unknown event children', async () => {
    const db = testEnvironment
      .authenticatedContext('moderator-user', { role: 'moderator' })
      .firestore();
    await assertSucceeds(getDoc(doc(db, privateEventPath)));
    await assertSucceeds(getDoc(doc(db, privateSnapshotPath)));
    await assertSucceeds(getDoc(doc(db, privateSnapshotSlidePath)));
    await assertFails(setDoc(doc(db, privateEventPath), { title: 'Denied' }));
    await assertFails(setDoc(doc(db, privateSnapshotPath), { quizId: 'forged' }));
    await assertFails(getDoc(doc(db, privateEventChildPath)));
  });
});

describe('admin', () => {
  test('can read a quiz document', async () => {
    const db = testEnvironment
      .authenticatedContext('admin-user', { role: 'admin' })
      .firestore();
    await assertSucceeds(getDoc(doc(db, privateQuizPath)));
  });

  test('can read but cannot directly write a private live session', async () => {
    const db = testEnvironment
      .authenticatedContext('admin-user', { role: 'admin' })
      .firestore();
    await assertSucceeds(getDoc(doc(db, privateSessionPath)));
    await assertFails(setDoc(doc(db, privateSessionPath), { status: 'ended' }));
  });

  test('cannot bypass trusted editor Functions with a direct quiz write', async () => {
    const db = testEnvironment
      .authenticatedContext('admin-user', { role: 'admin' })
      .firestore();
    await assertFails(setDoc(doc(db, 'quizzes/admin-write'), { title: 'Denied' }));
  });

  test('can read event and snapshot data but cannot directly mutate authoritative event paths', async () => {
    const db = testEnvironment
      .authenticatedContext('admin-user', { role: 'admin' })
      .firestore();
    await assertSucceeds(getDoc(doc(db, privateEventPath)));
    await assertSucceeds(getDoc(doc(db, privateSnapshotPath)));
    await assertSucceeds(getDoc(doc(db, privateSnapshotSlidePath)));
    await assertFails(setDoc(doc(db, privateEventPath), { title: 'Bypass' }));
    await assertFails(setDoc(doc(db, privateEventChildPath), { secret: false }));
    await assertFails(setDoc(doc(db, privateSnapshotSlidePath), { correctAnswer: 'Bypass' }));
    await assertFails(setDoc(doc(db, publicEventPath), { title: 'Bypass' }));
  });
});

test('an unknown path remains denied even for an admin', async () => {
  const db = testEnvironment
    .authenticatedContext('admin-user', { role: 'admin' })
    .firestore();
  await assertFails(getDoc(doc(db, 'unknown/private-document')));
});
