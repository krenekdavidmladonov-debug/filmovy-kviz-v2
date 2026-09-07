import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp, type DocumentSnapshot } from 'firebase-admin/firestore';
import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/v2/https';

import { buildPublicEventProjection } from '../events/model.js';
import { capacityAfter, effectiveRegistrationStatus, hasCapacity } from './domain.js';
import type { RegistrationCapacity, RegistrationInput } from './types.js';
import { registrationInput, registrationWindow, requestId, requestToken } from './validation.js';

if (getApps().length === 0) initializeApp();
const db = getFirestore();
const callableOptions = { region: 'europe-west1', cors: true } as const;

interface EventState {
  readonly data: Record<string, unknown>;
  readonly revision: number;
  readonly lifecycleStatus: string;
  readonly published: boolean;
  readonly opensAt: Timestamp | null;
  readonly closesAt: Timestamp | null;
  readonly capacity: RegistrationCapacity;
  readonly teamSizeMin: number;
  readonly teamSizeMax: number;
}

function record(value: unknown, message = 'Stored data is malformed.'): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new HttpsError('failed-precondition', message);
  }
  return value as Record<string, unknown>;
}

function integer(value: unknown, minimum: number, message: string): number {
  if (!Number.isInteger(value) || (value as number) < minimum) throw new HttpsError('failed-precondition', message);
  return value as number;
}

function eventState(snapshot: DocumentSnapshot): EventState {
  if (!snapshot.exists) throw new HttpsError('not-found', 'Event was not found.');
  const data = record(snapshot.data(), 'Event is malformed.');
  const teamCapacity = integer(data.teamCapacity, 1, 'Event capacity is malformed.');
  const peopleCapacity = integer(data.peopleCapacity, 1, 'Event capacity is malformed.');
  const acceptedTeams = data.acceptedTeams === undefined ? 0 : integer(data.acceptedTeams, 0, 'Event counters are malformed.');
  const acceptedPeople = data.acceptedPeople === undefined ? 0 : integer(data.acceptedPeople, 0, 'Event counters are malformed.');
  const opensAt = data.registrationOpensAt instanceof Timestamp ? data.registrationOpensAt : null;
  const closesAt = data.registrationClosesAt instanceof Timestamp ? data.registrationClosesAt : null;
  return {
    data,
    revision: integer(data.revision, 1, 'Event revision is malformed.'),
    lifecycleStatus: typeof data.lifecycleStatus === 'string' ? data.lifecycleStatus : 'scheduled',
    published: data.registrationPublished === true,
    opensAt,
    closesAt,
    capacity: { acceptedTeams, acceptedPeople, maximumTeams: teamCapacity, maximumPeople: peopleCapacity },
    teamSizeMin: integer(data.teamSizeMin, 1, 'Event team limits are malformed.'),
    teamSizeMax: integer(data.teamSizeMax, 1, 'Event team limits are malformed.'),
  };
}

function requireAdmin(auth: CallableRequest<unknown>['auth']): string {
  if (auth === undefined) throw new HttpsError('unauthenticated', 'Authentication is required.');
  if (auth.token.role !== 'admin') throw new HttpsError('permission-denied', 'Administrator access is required.');
  return auth.uid;
}

function requirePublicCaller(auth: CallableRequest<unknown>['auth']): void {
  if (auth !== undefined) throw new HttpsError('permission-denied', 'Use the public registration form without a staff session.');
}

function statusAt(event: EventState, now: Timestamp) {
  if (event.opensAt === null || event.closesAt === null) return 'closed' as const;
  return effectiveRegistrationStatus({
    published: event.published,
    lifecycleStatus: event.lifecycleStatus,
    opensAtMillis: event.opensAt.toMillis(),
    closesAtMillis: event.closesAt.toMillis(),
    nowMillis: now.toMillis(),
    capacity: event.capacity,
  });
}

function publicProjection(event: EventState, status: 'scheduled' | 'open' | 'full' | 'closed', now: Timestamp) {
  const venue = record(event.data.venue, 'Event venue is malformed.');
  if (typeof event.data.title !== 'string' || typeof event.data.timeZone !== 'string'
    || typeof venue.name !== 'string' || typeof venue.publicLocation !== 'string') {
    throw new HttpsError('failed-precondition', 'Event public data is malformed.');
  }
  return buildPublicEventProjection({
    title: event.data.title,
    startsAt: event.data.startsAt,
    timeZone: event.data.timeZone,
    venue: { name: venue.name, publicLocation: venue.publicLocation },
    registrationStatus: status,
    registrationPublished: event.published,
    teamSizeMin: event.teamSizeMin,
    teamSizeMax: event.teamSizeMax,
    teamCapacity: event.capacity.maximumTeams,
    peopleCapacity: event.capacity.maximumPeople,
    acceptedTeams: event.capacity.acceptedTeams,
    acceptedPeople: event.capacity.acceptedPeople,
    registrationOpensAt: event.opensAt,
    registrationClosesAt: event.closesAt,
    revision: event.revision,
    updatedAt: now,
  });
}

function assertWindowOpen(event: EventState, now: Timestamp, allowFull = false): void {
  const status = statusAt(event, now);
  if (status !== 'open' && !(allowFull && status === 'full')) {
    throw new HttpsError('failed-precondition', status === 'full' ? 'Registration capacity is full.' : 'Registration is closed.');
  }
}

function assertTeamSize(event: EventState, input: RegistrationInput): void {
  if (input.memberCount < event.teamSizeMin || input.memberCount > event.teamSizeMax) {
    throw new HttpsError('invalid-argument', `Team size must be between ${event.teamSizeMin} and ${event.teamSizeMax}.`);
  }
}

function tokenHash(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

function nameKey(normalizedName: string): string {
  return createHash('sha256').update(normalizedName, 'utf8').digest('hex');
}

function verifyToken(storedHash: unknown, token: string): void {
  const supplied = Buffer.from(tokenHash(token), 'hex');
  const stored = typeof storedHash === 'string' && /^[a-f0-9]{64}$/u.test(storedHash)
    ? Buffer.from(storedHash, 'hex') : Buffer.alloc(0);
  if (stored.length !== supplied.length || !timingSafeEqual(stored, supplied)) {
    throw new HttpsError('not-found', 'Registration was not found.');
  }
}

function safeResponse(id: string, data: Record<string, unknown>, managementToken?: string) {
  return {
    eventId: data.eventId,
    registrationId: id,
    teamName: data.teamName,
    memberCount: data.memberCount,
    contactEmail: data.contactEmail,
    status: data.status,
    ...(managementToken === undefined ? {} : { managementToken }),
  };
}

export const configureEventRegistration = onCall(callableOptions, async (request) => {
  const uid = requireAdmin(request.auth);
  const eventId = requestId(request.data, 'eventId');
  const expectedRevision = record(request.data).expectedRevision;
  if (!Number.isInteger(expectedRevision) || (expectedRevision as number) < 1) {
    throw new HttpsError('invalid-argument', 'expectedRevision is invalid.');
  }
  const window = registrationWindow(request.data);
  const eventRef = db.collection('events').doc(eventId);
  const publicRef = db.collection('publicEvents').doc(eventId);
  return db.runTransaction(async (transaction) => {
    const current = eventState(await transaction.get(eventRef));
    if (current.revision !== expectedRevision) throw new HttpsError('aborted', 'Event changed. Reload and try again.');
    const now = Timestamp.now();
    const revision = current.revision + 1;
    const next: EventState = {
      ...current,
      revision,
      published: window.published,
      opensAt: Timestamp.fromDate(window.opensAt),
      closesAt: Timestamp.fromDate(window.closesAt),
    };
    const registrationStatus = statusAt(next, now);
    transaction.update(eventRef, {
      registrationPublished: window.published,
      registrationOpensAt: next.opensAt,
      registrationClosesAt: next.closesAt,
      registrationStatus,
      revision,
      updatedAt: now,
      updatedBy: uid,
    });
    transaction.set(publicRef, publicProjection(next, registrationStatus, now));
    return { eventId, revision, registrationStatus };
  });
});

export const createEventRegistration = onCall(callableOptions, async (request) => {
  requirePublicCaller(request.auth);
  const eventId = requestId(request.data, 'eventId');
  const input = registrationInput(request.data);
  const rawToken = randomBytes(32).toString('base64url');
  const registrationRef = db.collection('events').doc(eventId).collection('registrations').doc();
  const eventRef = db.collection('events').doc(eventId);
  const nameRef = eventRef.collection('registrationNames').doc(nameKey(input.normalizedTeamName));
  const publicRef = db.collection('publicEvents').doc(eventId);
  return db.runTransaction(async (transaction) => {
    const event = eventState(await transaction.get(eventRef));
    const existingName = await transaction.get(nameRef);
    const now = Timestamp.now();
    assertWindowOpen(event, now);
    assertTeamSize(event, input);
    if (existingName.exists) throw new HttpsError('already-exists', 'A team with this name is already registered.');
    if (!hasCapacity(event.capacity, 1, input.memberCount)) {
      throw new HttpsError('resource-exhausted', 'Registration capacity is full.');
    }
    const capacity = capacityAfter(event.capacity, 1, input.memberCount);
    const next = { ...event, capacity };
    const registrationStatus = statusAt(next, now);
    const registrationData = {
      schemaVersion: 1,
      eventId,
      teamName: input.teamName,
      normalizedTeamName: input.normalizedTeamName,
      memberCount: input.memberCount,
      contactEmail: input.contactEmail,
      status: 'accepted',
      managementTokenHash: tokenHash(rawToken),
      createdAt: now,
      updatedAt: now,
      cancelledAt: null,
      cancelledBy: null,
    };
    transaction.create(registrationRef, registrationData);
    transaction.create(nameRef, { registrationId: registrationRef.id, createdAt: now });
    transaction.update(eventRef, {
      acceptedTeams: capacity.acceptedTeams,
      acceptedPeople: capacity.acceptedPeople,
      registrationStatus,
      updatedAt: now,
    });
    transaction.set(publicRef, publicProjection(next, registrationStatus, now));
    return safeResponse(registrationRef.id, registrationData, rawToken);
  });
});

export const getEventRegistration = onCall(callableOptions, async (request) => {
  requirePublicCaller(request.auth);
  const eventId = requestId(request.data, 'eventId');
  const registrationId = requestId(request.data, 'registrationId');
  const token = requestToken(request.data);
  const snapshot = await db.collection('events').doc(eventId).collection('registrations').doc(registrationId).get();
  if (!snapshot.exists) throw new HttpsError('not-found', 'Registration was not found.');
  const data = record(snapshot.data());
  verifyToken(data.managementTokenHash, token);
  return safeResponse(snapshot.id, data);
});

export const updateEventRegistration = onCall(callableOptions, async (request) => {
  requirePublicCaller(request.auth);
  const eventId = requestId(request.data, 'eventId');
  const registrationId = requestId(request.data, 'registrationId');
  const token = requestToken(request.data);
  const input = registrationInput(request.data);
  const eventRef = db.collection('events').doc(eventId);
  const registrationRef = eventRef.collection('registrations').doc(registrationId);
  const publicRef = db.collection('publicEvents').doc(eventId);
  return db.runTransaction(async (transaction) => {
    const event = eventState(await transaction.get(eventRef));
    const registrationSnapshot = await transaction.get(registrationRef);
    if (!registrationSnapshot.exists) throw new HttpsError('not-found', 'Registration was not found.');
    const current = record(registrationSnapshot.data());
    verifyToken(current.managementTokenHash, token);
    if (current.status !== 'accepted') throw new HttpsError('failed-precondition', 'Registration is cancelled.');
    const oldNormalized = typeof current.normalizedTeamName === 'string' ? current.normalizedTeamName : '';
    const oldMemberCount = integer(current.memberCount, 1, 'Registration is malformed.');
    const oldNameRef = eventRef.collection('registrationNames').doc(nameKey(oldNormalized));
    const newNameRef = eventRef.collection('registrationNames').doc(nameKey(input.normalizedTeamName));
    const newNameSnapshot = input.normalizedTeamName === oldNormalized ? undefined : await transaction.get(newNameRef);
    const now = Timestamp.now();
    assertWindowOpen(event, now, true);
    assertTeamSize(event, input);
    if (newNameSnapshot?.exists) throw new HttpsError('already-exists', 'A team with this name is already registered.');
    const peopleDelta = input.memberCount - oldMemberCount;
    if (!hasCapacity(event.capacity, 0, peopleDelta)) throw new HttpsError('resource-exhausted', 'People capacity is full.');
    const capacity = capacityAfter(event.capacity, 0, peopleDelta);
    const next = { ...event, capacity };
    const registrationStatus = statusAt(next, now);
    transaction.update(registrationRef, {
      teamName: input.teamName,
      normalizedTeamName: input.normalizedTeamName,
      memberCount: input.memberCount,
      contactEmail: input.contactEmail,
      updatedAt: now,
    });
    if (input.normalizedTeamName !== oldNormalized) {
      transaction.delete(oldNameRef);
      transaction.create(newNameRef, { registrationId, createdAt: now });
    }
    transaction.update(eventRef, {
      acceptedPeople: capacity.acceptedPeople,
      registrationStatus,
      updatedAt: now,
    });
    transaction.set(publicRef, publicProjection(next, registrationStatus, now));
    return safeResponse(registrationId, { ...current, ...input, status: 'accepted' });
  });
});

async function cancelRegistration(
  eventId: string,
  registrationId: string,
  actor: string,
  token?: string,
  requireOpen = true,
) {
  const eventRef = db.collection('events').doc(eventId);
  const registrationRef = eventRef.collection('registrations').doc(registrationId);
  const publicRef = db.collection('publicEvents').doc(eventId);
  return db.runTransaction(async (transaction) => {
    const event = eventState(await transaction.get(eventRef));
    const registrationSnapshot = await transaction.get(registrationRef);
    if (!registrationSnapshot.exists) throw new HttpsError('not-found', 'Registration was not found.');
    const current = record(registrationSnapshot.data());
    if (token !== undefined) verifyToken(current.managementTokenHash, token);
    if (current.status === 'cancelled') return safeResponse(registrationId, current);
    if (current.status !== 'accepted') throw new HttpsError('failed-precondition', 'Registration cannot be cancelled.');
    const memberCount = integer(current.memberCount, 1, 'Registration is malformed.');
    const normalized = typeof current.normalizedTeamName === 'string' ? current.normalizedTeamName : '';
    const nameRef = eventRef.collection('registrationNames').doc(nameKey(normalized));
    await transaction.get(nameRef);
    const now = Timestamp.now();
    if (requireOpen) assertWindowOpen(event, now, true);
    const capacity = capacityAfter(event.capacity, -1, -memberCount);
    if (!hasCapacity(capacity, 0, 0)) throw new HttpsError('failed-precondition', 'Event counters are malformed.');
    const next = { ...event, capacity };
    const registrationStatus = statusAt(next, now);
    transaction.update(registrationRef, { status: 'cancelled', cancelledAt: now, cancelledBy: actor, updatedAt: now });
    transaction.delete(nameRef);
    transaction.update(eventRef, {
      acceptedTeams: capacity.acceptedTeams,
      acceptedPeople: capacity.acceptedPeople,
      registrationStatus,
      updatedAt: now,
    });
    transaction.set(publicRef, publicProjection(next, registrationStatus, now));
    return safeResponse(registrationId, { ...current, status: 'cancelled' });
  });
}

export const cancelEventRegistration = onCall(callableOptions, async (request) => {
  requirePublicCaller(request.auth);
  return cancelRegistration(
    requestId(request.data, 'eventId'),
    requestId(request.data, 'registrationId'),
    'management-link',
    requestToken(request.data),
  );
});

export const adminCancelEventRegistration = onCall(callableOptions, async (request) => {
  const uid = requireAdmin(request.auth);
  return cancelRegistration(
    requestId(request.data, 'eventId'),
    requestId(request.data, 'registrationId'),
    `admin:${uid}`,
    undefined,
    false,
  );
});
