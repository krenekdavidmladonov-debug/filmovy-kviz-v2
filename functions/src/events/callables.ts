import { closeEventPresentation } from '../live/event-lifecycle.js';
import {
  mapEditorQuiz,
  mapEditorSlide,
  runQuizPreflight,
  type PreflightIssue,
} from '@filmovy-kviz/quiz-domain';
import { getApps, initializeApp } from 'firebase-admin/app';
import {
  getFirestore,
  Timestamp,
  type DocumentSnapshot,
  type QueryDocumentSnapshot,
  type Transaction,
} from 'firebase-admin/firestore';
import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/v2/https';

import {
  buildPublicEventProjection,
  canArchiveEvent,
  canCancelEvent,
  canLockQuiz,
  canMutateEvent,
  defaultScoringConfiguration,
  isEventLifecycleStatus,
  isRegistrationStatus,
} from './model.js';
import {
  buildQuizSnapshotMetadata,
  decidePreflightLock,
  snapshotWriteCount,
} from './snapshot-model.js';
import type {
  EventConfigurationInput,
  EventLifecycleStatus,
  EventMutationResponse,
  EventScoringConfiguration,
  EventVenueInput,
  RegistrationStatus,
} from './types.js';
import {
  expectedRevision,
  isObject,
  requestedBoolean,
  requestedEventConfiguration,
  requiredId,
} from './validation.js';

if (getApps().length === 0) initializeApp();
const db = getFirestore();
const callableOptions = { region: 'europe-west1', cors: true } as const;
const maximumSnapshotWrites = 475;

interface AdminActor { readonly uid: string; readonly role: 'admin' }
interface StoredEvent {
  readonly title: string;
  readonly startsAt: unknown;
  readonly timeZone: string;
  readonly venue: EventVenueInput;
  readonly teamCapacity: number;
  readonly peopleCapacity: number;
  readonly teamSizeMin: number;
  readonly teamSizeMax: number;
  readonly acceptedTeams: number;
  readonly acceptedPeople: number;
  readonly registrationOpensAt: unknown;
  readonly registrationClosesAt: unknown;
  readonly registrationStatus: RegistrationStatus;
  readonly registrationPublished: boolean;
  readonly lifecycleStatus: EventLifecycleStatus;
  readonly scoring: EventScoringConfiguration;
  readonly revision: number;
}

export function authorizeEventAdmin(auth: CallableRequest<unknown>['auth']): AdminActor {
  if (auth === undefined) throw new HttpsError('unauthenticated', 'Authentication is required.');
  if (auth.token.role !== 'admin') {
    throw new HttpsError('permission-denied', 'Only an administrator can change events.');
  }
  return { uid: auth.uid, role: 'admin' };
}

function snapshotData(snapshot: DocumentSnapshot, location: string): Record<string, unknown> {
  const value: unknown = snapshot.data();
  if (!isObject(value)) throw new HttpsError('failed-precondition', `${location} is malformed.`);
  return value;
}

function storedPositiveInteger(data: Record<string, unknown>, field: string): number {
  const value = data[field];
  if (!Number.isInteger(value) || (value as number) <= 0) {
    throw new HttpsError('failed-precondition', 'Event capacity configuration is malformed.');
  }
  return value as number;
}

function storedText(data: Record<string, unknown>, field: string, location: string): string {
  const value = data[field];
  if (typeof value !== 'string') throw new HttpsError('failed-precondition', `${location} is malformed.`);
  return value;
}

function storedEvent(snapshot: DocumentSnapshot): StoredEvent {
  if (!snapshot.exists) throw new HttpsError('not-found', 'Event was not found.');
  const data = snapshotData(snapshot, 'Event');
  const venue = data.venue;
  const scoring = data.scoring;
  if (!isObject(venue) || !isObject(scoring)
    || !isRegistrationStatus(data.registrationStatus)
    || !isEventLifecycleStatus(data.lifecycleStatus)
    || scoring.unitScale !== 2
    || scoring.rankingMode !== 'dense'
    || typeof scoring.started !== 'boolean'
    || !Number.isInteger(data.revision)
    || (data.revision as number) < 1) {
    throw new HttpsError('failed-precondition', 'Event is malformed.');
  }
  return {
    title: storedText(data, 'title', 'Event'),
    startsAt: data.startsAt,
    timeZone: storedText(data, 'timeZone', 'Event'),
    venue: {
      name: storedText(venue, 'name', 'Event venue'),
      publicLocation: storedText(venue, 'publicLocation', 'Event venue'),
    },
    teamCapacity: storedPositiveInteger(data, 'teamCapacity'),
    peopleCapacity: storedPositiveInteger(data, 'peopleCapacity'),
    teamSizeMin: storedPositiveInteger(data, 'teamSizeMin'),
    teamSizeMax: storedPositiveInteger(data, 'teamSizeMax'),
    acceptedTeams: Number.isInteger(data.acceptedTeams) && (data.acceptedTeams as number) >= 0
      ? data.acceptedTeams as number : 0,
    acceptedPeople: Number.isInteger(data.acceptedPeople) && (data.acceptedPeople as number) >= 0
      ? data.acceptedPeople as number : 0,
    registrationOpensAt: data.registrationOpensAt ?? null,
    registrationClosesAt: data.registrationClosesAt ?? null,
    registrationStatus: data.registrationStatus,
    registrationPublished: data.registrationPublished === true,
    lifecycleStatus: data.lifecycleStatus,
    scoring: {
      unitScale: 2,
      rankingMode: 'dense',
      started: scoring.started,
    },
    revision: data.revision as number,
  };
}

function assertExpectedRevision(event: StoredEvent, requested: number): void {
  if (event.revision !== requested) {
    throw new HttpsError('aborted', 'Event changed in another client. Reload and try again.');
  }
}

function publicProjection(
  event: Pick<StoredEvent, 'title' | 'startsAt' | 'timeZone' | 'venue' | 'registrationStatus' | 'registrationPublished' | 'teamSizeMin' | 'teamSizeMax' | 'teamCapacity' | 'peopleCapacity' | 'acceptedTeams' | 'acceptedPeople' | 'registrationOpensAt' | 'registrationClosesAt'>,
  revision: number,
  updatedAt: Timestamp,
): Record<string, unknown> {
  return buildPublicEventProjection({ ...event, revision, updatedAt });
}

function configurationFields(configuration: EventConfigurationInput): Record<string, unknown> {
  return {
    title: configuration.title,
    startsAt: Timestamp.fromDate(configuration.startsAt),
    timeZone: configuration.timeZone,
    venue: configuration.venue,
    teamCapacity: configuration.teamCapacity,
    peopleCapacity: configuration.peopleCapacity,
    teamSizeMin: configuration.teamSizeMin,
    teamSizeMax: configuration.teamSizeMax,
  };
}

function response(eventId: string, revision: number, lifecycleStatus: EventLifecycleStatus, registrationStatus: RegistrationStatus): EventMutationResponse {
  return { eventId, revision, lifecycleStatus, registrationStatus };
}

function safePreflightIssues(issues: readonly PreflightIssue[]): readonly Record<string, unknown>[] {
  return issues.map((issue) => ({
    severity: issue.severity,
    code: issue.code,
    category: issue.category,
    reference: issue.reference,
    ...(issue.fixTarget === undefined ? {} : { fixTarget: issue.fixTarget }),
  }));
}

export const createEvent = onCall(callableOptions, async (request): Promise<EventMutationResponse> => {
  const actor = authorizeEventAdmin(request.auth);
  const initialRevision = expectedRevision(request.data);
  if (initialRevision !== 0) throw new HttpsError('invalid-argument', 'A new event must use expectedRevision 0.');
  const configuration = requestedEventConfiguration(request.data);
  const eventRef = db.collection('events').doc();
  const publicRef = db.collection('publicEvents').doc(eventRef.id);
  const now = Timestamp.now();
  const registrationStatus: RegistrationStatus = 'scheduled';
  const lifecycleStatus: EventLifecycleStatus = 'scheduled';
  const eventData = {
    schemaVersion: 1,
    ...configurationFields(configuration),
    registrationStatus,
    registrationPublished: false,
    acceptedTeams: 0,
    acceptedPeople: 0,
    registrationOpensAt: null,
    registrationClosesAt: null,
    lifecycleStatus,
    quizAssignment: null,
    scoring: defaultScoringConfiguration,
    revision: 1,
    createdAt: now,
    createdBy: actor.uid,
    updatedAt: now,
    updatedBy: actor.uid,
  };
  await db.runTransaction(async (transaction) => {
    if ((await transaction.get(eventRef)).exists) {
      throw new HttpsError('already-exists', 'Event identifier collision. Try again.');
    }
    transaction.create(eventRef, eventData);
    transaction.create(publicRef, publicProjection({
      title: configuration.title,
      startsAt: Timestamp.fromDate(configuration.startsAt),
      timeZone: configuration.timeZone,
      venue: configuration.venue,
      registrationStatus,
      registrationPublished: false,
      teamSizeMin: configuration.teamSizeMin,
      teamSizeMax: configuration.teamSizeMax,
      teamCapacity: configuration.teamCapacity,
      peopleCapacity: configuration.peopleCapacity,
      acceptedTeams: 0,
      acceptedPeople: 0,
      registrationOpensAt: null,
      registrationClosesAt: null,
    }, 1, now));
  });
  return response(eventRef.id, 1, lifecycleStatus, registrationStatus);
});

export const updateEvent = onCall(callableOptions, async (request): Promise<EventMutationResponse> => {
  const actor = authorizeEventAdmin(request.auth);
  const eventId = requiredId(request.data, 'eventId');
  const requestedRevision = expectedRevision(request.data);
  const configuration = requestedEventConfiguration(request.data);
  const eventRef = db.collection('events').doc(eventId);
  const publicRef = db.collection('publicEvents').doc(eventId);
  return db.runTransaction(async (transaction) => {
    const current = storedEvent(await transaction.get(eventRef));
    assertExpectedRevision(current, requestedRevision);
    if (!canMutateEvent(current.lifecycleStatus)) {
      throw new HttpsError('failed-precondition', 'This event can no longer be edited.');
    }
    if (configuration.teamCapacity < current.acceptedTeams
      || configuration.peopleCapacity < current.acceptedPeople) {
      throw new HttpsError('failed-precondition', 'Capacity cannot be lower than accepted registrations.');
    }
    const now = Timestamp.now();
    const revision = current.revision + 1;
    const fields = configurationFields(configuration);
    const capacityFull = current.acceptedTeams >= configuration.teamCapacity
      || current.acceptedPeople >= configuration.peopleCapacity;
    const registrationStatus = current.registrationStatus === 'open' && capacityFull
      ? 'full'
      : current.registrationStatus === 'full' && !capacityFull ? 'open' : current.registrationStatus;
    transaction.update(eventRef, { ...fields, registrationStatus, revision, updatedAt: now, updatedBy: actor.uid });
    transaction.set(publicRef, publicProjection({
      ...current,
      ...fields,
      registrationStatus,
      startsAt: fields.startsAt,
      venue: configuration.venue,
    }, revision, now));
    return response(eventId, revision, current.lifecycleStatus, registrationStatus);
  });
});

export const cancelEvent = onCall(callableOptions, async (request): Promise<EventMutationResponse> => {
  const actor = authorizeEventAdmin(request.auth);
  const eventId = requiredId(request.data, 'eventId');
  const requestedRevision = expectedRevision(request.data);
  const eventRef = db.collection('events').doc(eventId);
  const publicRef = db.collection('publicEvents').doc(eventId);
  return db.runTransaction(async (transaction) => {
    const current = storedEvent(await transaction.get(eventRef));
    assertExpectedRevision(current, requestedRevision);
    await closeEventPresentation(transaction, eventId, actor.uid);
    if (!canCancelEvent(current.lifecycleStatus)) {
      throw new HttpsError('failed-precondition', 'This event cannot be cancelled.');
    }
    const revision = current.revision + 1;
    const now = Timestamp.now();
    transaction.update(eventRef, {
      lifecycleStatus: 'cancelled', registrationStatus: 'closed',
      revision, updatedAt: now, updatedBy: actor.uid,
    });
    transaction.delete(publicRef);
    return response(eventId, revision, 'cancelled', 'closed');
  });
});

export const archiveEvent = onCall(callableOptions, async (request): Promise<EventMutationResponse> => {
  const actor = authorizeEventAdmin(request.auth);
  const eventId = requiredId(request.data, 'eventId');
  const requestedRevision = expectedRevision(request.data);
  const eventRef = db.collection('events').doc(eventId);
  const publicRef = db.collection('publicEvents').doc(eventId);
  return db.runTransaction(async (transaction) => {
    const current = storedEvent(await transaction.get(eventRef));
    assertExpectedRevision(current, requestedRevision);
    await closeEventPresentation(transaction, eventId, actor.uid);
    if (!canArchiveEvent(current.lifecycleStatus)) {
      throw new HttpsError('failed-precondition', 'Only a cancelled or completed event can be archived.');
    }
    const revision = current.revision + 1;
    const now = Timestamp.now();
    transaction.update(eventRef, {
      lifecycleStatus: 'archived', registrationStatus: 'closed',
      revision, updatedAt: now, updatedBy: actor.uid,
    });
    transaction.delete(publicRef);
    return response(eventId, revision, 'archived', 'closed');
  });
});

export const lockEventQuiz = onCall(callableOptions, async (request): Promise<EventMutationResponse> => {
  const actor = authorizeEventAdmin(request.auth);
  const eventId = requiredId(request.data, 'eventId');
  const quizId = requiredId(request.data, 'quizId');
  const requestedEventRevision = expectedRevision(request.data);
  const requestedQuizRevision = expectedRevision(request.data, 'expectedQuizRevision');
  const acknowledgeWarnings = requestedBoolean(request.data, 'acknowledgeWarnings');
  const eventRef = db.collection('events').doc(eventId);
  const publicRef = db.collection('publicEvents').doc(eventId);
  const quizRef = db.collection('quizzes').doc(quizId);
  const snapshotRef = db.collection('quizSnapshots').doc();

  return db.runTransaction(async (transaction: Transaction) => {
    const eventSnapshot = await transaction.get(eventRef);
    const quizSnapshot = await transaction.get(quizRef);
    const slideSnapshot = await transaction.get(quizRef.collection('slides').orderBy('position'));
    const roundSnapshot = await transaction.get(quizRef.collection('rounds').orderBy('position'));
    const event = storedEvent(eventSnapshot);
    if (eventSnapshot.data()?.liveSessionId) throw new HttpsError("failed-precondition", "Připravený kvíz již používá moderování akce.");
    assertExpectedRevision(event, requestedEventRevision);
    if (!canLockQuiz(event.lifecycleStatus, event.scoring.started)) {
      throw new HttpsError('failed-precondition', 'The event quiz can no longer be replaced.');
    }
    if (!quizSnapshot.exists) throw new HttpsError('not-found', 'Quiz was not found.');
    const quizData = snapshotData(quizSnapshot, 'Quiz');
    const actualQuizRevision = quizData.revision === undefined ? 0 : quizData.revision;
    if (!Number.isInteger(actualQuizRevision) || (actualQuizRevision as number) < 0) {
      throw new HttpsError('failed-precondition', 'Quiz revision is malformed.');
    }
    if (actualQuizRevision !== requestedQuizRevision) {
      throw new HttpsError('aborted', 'Quiz changed after readiness review. Reload and try again.');
    }
    if (snapshotWriteCount(slideSnapshot.size, roundSnapshot.size) > maximumSnapshotWrites) {
      throw new HttpsError('resource-exhausted', 'Quiz is too large for one atomic event snapshot.');
    }
    if (quizData.roundCount !== roundSnapshot.size) {
      throw new HttpsError('failed-precondition', 'Quiz roundCount does not match its stored rounds.');
    }
    const roundTitles = new Map<string, string>();
    for (const round of roundSnapshot.docs) {
      const title: unknown = round.data().title;
      if (typeof title === 'string') roundTitles.set(round.id, title);
    }
    let quiz;
    try {
      const slides = slideSnapshot.docs.map((slide: QueryDocumentSnapshot) => {
        const mapped = mapEditorSlide(slide.id, slide.data());
        const title = mapped.roundId === undefined ? undefined : roundTitles.get(mapped.roundId);
        return mapped.roundTitle !== undefined || title === undefined ? mapped : { ...mapped, roundTitle: title };
      });
      quiz = mapEditorQuiz(quizSnapshot.id, quizData, slides);
    } catch {
      throw new HttpsError('failed-precondition', 'Quiz cannot be mapped for readiness validation.');
    }
    const preflight = runQuizPreflight(quiz);
    const lockDecision = decidePreflightLock(preflight, acknowledgeWarnings);
    if (lockDecision === 'BLOCKED') {
      throw new HttpsError('failed-precondition', 'Quiz has blocking readiness issues.', {
        reason: 'QUIZ_BLOCKED',
        status: preflight.status,
        blockerCount: preflight.blockerCount,
        warningCount: preflight.warningCount,
        issues: safePreflightIssues(preflight.issues),
      });
    }
    if (lockDecision === 'WARNINGS_REQUIRE_ACKNOWLEDGEMENT') {
      throw new HttpsError('failed-precondition', 'Quiz warnings require explicit acknowledgement.', {
        reason: 'WARNINGS_REQUIRE_ACKNOWLEDGEMENT',
        status: preflight.status,
        blockerCount: 0,
        warningCount: preflight.warningCount,
        issues: safePreflightIssues(preflight.issues),
      });
    }

    const now = Timestamp.now();
    const revision = event.revision + 1;
    const preflightStatus: 'READY' | 'READY_WITH_WARNINGS' = preflight.warningCount > 0
      ? 'READY_WITH_WARNINGS'
      : 'READY';
    const preflightSummary = {
      status: preflightStatus,
      blockerCount: 0,
      warningCount: preflight.warningCount,
    } as const;
    transaction.create(snapshotRef, buildQuizSnapshotMetadata(quiz, preflight, actor.uid, now));
    for (const slide of slideSnapshot.docs) {
      transaction.create(snapshotRef.collection('slides').doc(slide.id), slide.data());
    }
    for (const round of roundSnapshot.docs) {
      transaction.create(snapshotRef.collection('rounds').doc(round.id), round.data());
    }
    const quizAssignment = {
      quizId,
      quizRevision: requestedQuizRevision,
      snapshotId: snapshotRef.id,
      quizTitle: quiz.title,
      roundCount: quiz.roundCount,
      questionCount: quiz.questionCount,
      lockedAt: now,
    };
    transaction.update(eventRef, {
      quizAssignment,
      lifecycleStatus: 'ready',
      revision,
      updatedAt: now,
      updatedBy: actor.uid,
    });
    transaction.set(publicRef, publicProjection(event, revision, now));
    return {
      ...response(eventId, revision, 'ready', event.registrationStatus),
      snapshotId: snapshotRef.id,
      preflight: preflightSummary,
    };
  });
});
