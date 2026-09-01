import { getApps, initializeApp } from 'firebase-admin/app';
import {
  getFirestore,
  Timestamp,
  type DocumentSnapshot,
  type Transaction,
} from 'firebase-admin/firestore';
import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/v2/https';

import { LiveSessionError } from './errors.js';
import { buildPublicSessionState } from './publication.js';
import { applyLiveSessionAction } from './session-machine.js';
import type { LiveSessionAction, PrivateLiveSession, PrivateSlide } from './types.js';

if (getApps().length === 0) initializeApp();

const db = getFirestore();
const callableOptions = { region: 'europe-west1', cors: true } as const;

type StaffRole = 'admin' | 'moderator';
type MutationKind = 'go-to-slide' | 'next-slide' | 'previous-slide' | 'reveal-answer' | 'hide-answer' | 'end-session';

interface StaffActor {
  readonly uid: string;
  readonly role: StaffRole;
}

interface ControlResponse {
  readonly sessionId: string;
  readonly status: PrivateLiveSession['status'];
  readonly currentSlidePosition: number;
  readonly answerRevealed: boolean;
  readonly revision: number;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && !Array.isArray(value) && typeof value === 'object';
}

export function authorizeStaff(auth: CallableRequest<unknown>['auth']): StaffActor {
  if (auth === undefined) throw new HttpsError('unauthenticated', 'Authentication is required.');
  const token: Record<string, unknown> = auth.token;
  const role = token.role;
  if (role !== 'admin' && role !== 'moderator') {
    throw new HttpsError('permission-denied', 'A staff role is required.');
  }
  return { uid: auth.uid, role };
}

function snapshotData(snapshot: DocumentSnapshot, location: string): Record<string, unknown> {
  const value: unknown = snapshot.data();
  if (!isObject(value)) throw new LiveSessionError('failed-precondition', `${location} is malformed.`);
  return value;
}

function requiredId(data: unknown, field: string): string {
  if (!isObject(data) || typeof data[field] !== 'string') {
    throw new HttpsError('invalid-argument', `${field} is required.`);
  }
  const value = data[field];
  if (value.length === 0 || value.length > 1_500 || value.includes('/')) {
    throw new HttpsError('invalid-argument', `${field} is invalid.`);
  }
  return value;
}

function expectedRevision(data: unknown): number {
  if (!isObject(data) || !Number.isInteger(data.expectedRevision) || (data.expectedRevision as number) < 0) {
    throw new HttpsError('invalid-argument', 'expectedRevision must be a non-negative integer.');
  }
  return data.expectedRevision as number;
}

function requestedPosition(data: unknown): number {
  if (!isObject(data) || !Number.isInteger(data.position)) {
    throw new HttpsError('invalid-argument', 'position must be an integer.');
  }
  return data.position as number;
}

function requiredString(data: Record<string, unknown>, field: string, location: string): string {
  const value: unknown = data[field];
  if (typeof value !== 'string') {
    throw new LiveSessionError('failed-precondition', `${location} is malformed.`);
  }
  return value;
}

function requiredNumber(data: Record<string, unknown>, field: string, location: string): number {
  const value: unknown = data[field];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new LiveSessionError('failed-precondition', `${location} is malformed.`);
  }
  return value;
}

function parseSession(snapshot: DocumentSnapshot): PrivateLiveSession {
  if (!snapshot.exists) throw new LiveSessionError('not-found', 'Live session was not found.');
  const data = snapshotData(snapshot, 'Live session');
  const status = data.status;
  if (status !== 'waiting' && status !== 'active' && status !== 'ended') {
    throw new LiveSessionError('failed-precondition', 'Live session is malformed.');
  }
  const currentSlideId = data.currentSlideId;
  if (currentSlideId !== undefined && typeof currentSlideId !== 'string') {
    throw new LiveSessionError('failed-precondition', 'Live session is malformed.');
  }
  return {
    sessionId: snapshot.id,
    quizId: requiredString(data, 'quizId', 'Live session'),
    quizTitle: requiredString(data, 'quizTitle', 'Live session'),
    slideCount: requiredNumber(data, 'slideCount', 'Live session'),
    status,
    currentSlidePosition: requiredNumber(data, 'currentSlidePosition', 'Live session'),
    ...(currentSlideId === undefined ? {} : { currentSlideId }),
    answerRevealed: data.answerRevealed === true,
    revision: requiredNumber(data, 'revision', 'Live session'),
    createdBy: requiredString(data, 'createdBy', 'Live session'),
    updatedBy: requiredString(data, 'updatedBy', 'Live session'),
    createdAt: data.createdAt,
    startedAt: data.startedAt ?? null,
    endedAt: data.endedAt ?? null,
    updatedAt: data.updatedAt,
  };
}

function parseSlide(snapshot: DocumentSnapshot): PrivateSlide {
  if (!snapshot.exists) throw new LiveSessionError('not-found', 'Quiz slide was not found.');
  const data = snapshotData(snapshot, 'Quiz slide');
  return {
    id: snapshot.id,
    position: requiredNumber(data, 'position', 'Quiz slide'),
    kind: requiredString(data, 'kind', 'Quiz slide'),
    isQuestion: data.isQuestion === true,
    title: typeof data.title === 'string' ? data.title : '',
    text: typeof data.text === 'string' ? data.text : '',
    options: Array.isArray(data.options) ? data.options : [],
    media: Array.isArray(data.media) ? data.media : [],
    presentation: isObject(data.presentation) ? data.presentation : {},
    ...(!Object.hasOwn(data, 'correctAnswer') ? {} : { correctAnswer: data.correctAnswer }),
    ...(!Object.hasOwn(data, 'moderatorNote') ? {} : { moderatorNote: data.moderatorNote }),
    ...(!Object.hasOwn(data, 'legacy') ? {} : { legacy: data.legacy }),
  };
}

async function loadSlide(
  transaction: Transaction,
  quizId: string,
  position: number,
): Promise<PrivateSlide> {
  const query = db.collection('quizzes').doc(quizId).collection('slides')
    .where('position', '==', position).limit(2);
  const snapshot = await transaction.get(query);
  if (snapshot.size !== 1) {
    throw new LiveSessionError('failed-precondition', 'Quiz slide position is missing or ambiguous.');
  }
  return parseSlide(snapshot.docs[0]!);
}

function response(session: PrivateLiveSession): ControlResponse {
  return {
    sessionId: session.sessionId,
    status: session.status,
    currentSlidePosition: session.currentSlidePosition,
    answerRevealed: session.answerRevealed,
    revision: session.revision,
  };
}

function mapError(error: unknown): never {
  if (error instanceof HttpsError) throw error;
  if (error instanceof LiveSessionError) throw new HttpsError(error.code, error.message);
  throw new HttpsError('internal', 'Live session operation failed.');
}

export const createLiveSession = onCall(callableOptions, async (request): Promise<ControlResponse> => {
  try {
    const actor = authorizeStaff(request.auth);
    const quizId = requiredId(request.data, 'quizId');
    const quizRef = db.collection('quizzes').doc(quizId);
    const sessionRef = db.collection('sessions').doc();
    const publicRef = db.collection('publicSessions').doc(sessionRef.id);

    return await db.runTransaction(async (transaction) => {
      const quizSnapshot = await transaction.get(quizRef);
      if (!quizSnapshot.exists) throw new LiveSessionError('not-found', 'Quiz was not found.');
      const quiz = snapshotData(quizSnapshot, 'Quiz');
      const slideCount = requiredNumber(quiz, 'slideCount', 'Quiz');
      if (!Number.isInteger(slideCount) || slideCount < 1) {
        throw new LiveSessionError('failed-precondition', 'Quiz has no ordered slides.');
      }
      const now = Timestamp.now();
      const session: PrivateLiveSession = {
        sessionId: sessionRef.id,
        quizId,
        quizTitle: requiredString(quiz, 'title', 'Quiz'),
        slideCount,
        status: 'waiting',
        currentSlidePosition: 0,
        answerRevealed: false,
        revision: 0,
        createdBy: actor.uid,
        updatedBy: actor.uid,
        createdAt: now,
        startedAt: null,
        endedAt: null,
        updatedAt: now,
      };
      transaction.create(sessionRef, session);
      transaction.create(publicRef, buildPublicSessionState(session));
      return response(session);
    });
  } catch (error) {
    return mapError(error);
  }
});

async function mutateSession(
  request: CallableRequest<unknown>,
  kind: MutationKind,
): Promise<ControlResponse> {
  try {
    const actor = authorizeStaff(request.auth);
    const sessionId = requiredId(request.data, 'sessionId');
    const revision = expectedRevision(request.data);
    const explicitPosition = kind === 'go-to-slide' ? requestedPosition(request.data) : undefined;
    const sessionRef = db.collection('sessions').doc(sessionId);
    const publicRef = db.collection('publicSessions').doc(sessionId);

    return await db.runTransaction(async (transaction) => {
      const session = parseSession(await transaction.get(sessionRef));
      let slide: PrivateSlide | undefined;
      let action: LiveSessionAction;

      if (kind === 'end-session') {
        action = { type: kind };
      } else if (kind === 'reveal-answer' || kind === 'hide-answer') {
        if (session.currentSlidePosition < 1) {
          throw new LiveSessionError('failed-precondition', 'There is no active slide.');
        }
        slide = await loadSlide(transaction, session.quizId, session.currentSlidePosition);
        action = { type: kind };
      } else {
        const position = kind === 'go-to-slide'
          ? explicitPosition!
          : session.currentSlidePosition + (kind === 'next-slide' ? 1 : -1);
        if (!Number.isInteger(position) || position < 1 || position > session.slideCount) {
          throw new LiveSessionError('invalid-argument', 'Slide position is outside the quiz range.');
        }
        slide = await loadSlide(transaction, session.quizId, position);
        action = kind === 'go-to-slide'
          ? { type: kind, position, slideId: slide.id }
          : { type: kind, slideId: slide.id };
      }

      const updated = applyLiveSessionAction(session, action, revision, actor.uid, Timestamp.now(), slide);
      transaction.set(sessionRef, updated);
      transaction.set(publicRef, buildPublicSessionState(updated, slide));
      return response(updated);
    });
  } catch (error) {
    return mapError(error);
  }
}

export const goToSlide = onCall(callableOptions, (request) => mutateSession(request, 'go-to-slide'));
export const nextSlide = onCall(callableOptions, (request) => mutateSession(request, 'next-slide'));
export const previousSlide = onCall(callableOptions, (request) => mutateSession(request, 'previous-slide'));
export const revealAnswer = onCall(callableOptions, (request) => mutateSession(request, 'reveal-answer'));
export const hideAnswer = onCall(callableOptions, (request) => mutateSession(request, 'hide-answer'));
export const endLiveSession = onCall(callableOptions, (request) => mutateSession(request, 'end-session'));
