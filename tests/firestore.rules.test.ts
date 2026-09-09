import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';
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
const privateRegistrationPath = `${privateEventPath}/registrations/security-registration`;
const privateRegistrationNamePath = `${privateEventPath}/registrationNames/private-hash`;
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
    await setDoc(doc(context.firestore(), 'events/security-test-event/scores/pair'), { halfPoints: 0, revision: 1 });
    await setDoc(doc(context.firestore(), 'events/security-test-event/scores/pair/history/1'), { halfPoints: 0, revision: 1 });
    await setDoc(doc(context.firestore(), privateEventChildPath), { secret: true });
    await setDoc(doc(context.firestore(), privateRegistrationPath), { teamName: 'Synthetic team', contactEmail: 'team@example.test' });
    await setDoc(doc(context.firestore(), privateRegistrationNamePath), { registrationId: 'security-registration' });
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
    await assertFails(getDoc(doc(db, privateRegistrationPath)));
    await assertFails(getDocs(collection(db, `${privateEventPath}/registrations`)));
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
    await assertFails(getDoc(doc(db, privateRegistrationPath)));
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

  test('can read event registrations but not uniqueness state or write registration data', async () => {
    const db = testEnvironment
      .authenticatedContext('moderator-user', { role: 'moderator' })
      .firestore();
    await assertSucceeds(getDoc(doc(db, privateEventPath)));
    await assertSucceeds(getDoc(doc(db, privateRegistrationPath)));
    await assertSucceeds(getDocs(collection(db, `${privateEventPath}/registrations`)));
    await assertFails(getDoc(doc(db, privateRegistrationNamePath)));
    await assertFails(setDoc(doc(db, privateRegistrationPath), { teamName: 'Bypass' }));
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
    await assertSucceeds(getDoc(doc(db, privateRegistrationPath)));
    await assertSucceeds(getDocs(collection(db, `${privateEventPath}/registrations`)));
    await assertFails(getDoc(doc(db, privateRegistrationNamePath)));
    await assertSucceeds(getDoc(doc(db, privateSnapshotPath)));
    await assertSucceeds(getDoc(doc(db, privateSnapshotSlidePath)));
    await assertFails(setDoc(doc(db, privateEventPath), { title: 'Bypass' }));
    await assertFails(setDoc(doc(db, privateEventChildPath), { secret: false }));
    await assertFails(setDoc(doc(db, privateRegistrationPath), { contactEmail: 'forged@example.test' }));
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

describe('internal event scoring', () => {
  for (const role of [null, 'user', 'admin', 'moderator']) {
    test('score/history access for ' + String(role), async () => {
      const db = role === null ? testEnvironment.unauthenticatedContext().firestore()
        : testEnvironment.authenticatedContext('score-' + role, { role, managementToken: 'not-scoring-authority' }).firestore();
      const staff = role === 'admin' || role === 'moderator';
      for (const path of ['events/security-test-event/scores/pair', 'events/security-test-event/scores/pair/history/1']) {
        await (staff ? assertSucceeds : assertFails)(getDoc(doc(db, path)));
        await assertFails(setDoc(doc(db, path), { halfPoints: 20, revision: 1 }));
        await assertFails(updateDoc(doc(db, path), { halfPoints: 30 }));
        await assertFails(deleteDoc(doc(db, path)));
      }
      await (staff ? assertSucceeds : assertFails)(getDocs(collection(db, 'events/security-test-event/scores')));
      await (staff ? assertSucceeds : assertFails)(getDocs(collection(db, 'events/security-test-event/scores/pair/history')));
      await assertFails(getDoc(doc(db, 'events/security-test-event/scoreOperations/key')));
      await assertFails(setDoc(doc(db, 'events/security-test-event/scoreOperations/key'), { response: {} }));
    });
  }
});

describe('referee grants are server-only, capabilities do not grant Firestore roles', () => {
  for (const role of [null, 'referee', 'moderator', 'admin']) test('deny grant and limiter paths for ' + String(role), async () => {
    const db = role === null ? testEnvironment.unauthenticatedContext().firestore() : testEnvironment.authenticatedContext('ref-' + role, { role, refereeAccessId: 'fake', eventId: 'security-test-event' }).firestore();
    for (const path of ['events/security-test-event/refereeAccess/access', 'refereeRateLimits/ip']) {
      await assertFails(getDoc(doc(db, path))); await assertFails(setDoc(doc(db, path), { keyHash: 'forged' }));
      await assertFails(updateDoc(doc(db, path), { revoked: false })); await assertFails(deleteDoc(doc(db, path)));
    }
    if (role === 'referee') for (const path of ['events/security-test-event/scores/pair','events/security-test-event/scores/pair/history/1',privateSnapshotPath,privateRegistrationPath]) {
      await assertFails(getDoc(doc(db,path))); await assertFails(setDoc(doc(db,path),{forged:true}));
    }
  });
});

describe('interim result versions and publication authority', () => {
  for (const role of [null, 'user', 'referee', 'moderator', 'admin']) {
    test('private versions and read-only publication for ' + String(role), async () => {
      const db = role === null ? testEnvironment.unauthenticatedContext().firestore()
        : testEnvironment.authenticatedContext('leaderboard-' + role, { role, managementToken: 'not-staff', refereeAccessId: 'not-staff' }).firestore();
      const staff = role === 'admin' || role === 'moderator';
      for (const child of ['interimVersions', 'interimOperations']) {
        const path = `${privateSessionPath}/${child}/version`;
        await testEnvironment.withSecurityRulesDisabled(async context => {
          await setDoc(doc(context.firestore(), path), { rows: [{ teamName: 'Private' }], actorUid: 'staff', eventId: 'security-test-event' });
        });
        await (staff ? assertSucceeds : assertFails)(getDoc(doc(db, path)));
        await (staff ? assertSucceeds : assertFails)(getDocs(collection(db, `${privateSessionPath}/${child}`)));
        await assertFails(setDoc(doc(db, path), { rows: [] }));
        await assertFails(updateDoc(doc(db, path), { rows: [] }));
        await assertFails(deleteDoc(doc(db, path)));
      }
      await assertSucceeds(getDoc(doc(db, publicSessionPath)));
      await assertFails(getDocs(collection(db, 'publicSessions')));
      await assertFails(setDoc(doc(db, publicSessionPath), { interimResults: { rows: [] } }));
      await assertFails(getDoc(doc(db, `${publicSessionPath}/interimVersions/version`)));
    });
  }
});
