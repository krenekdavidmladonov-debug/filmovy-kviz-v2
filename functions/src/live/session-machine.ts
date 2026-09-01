import { LiveSessionError } from './errors.js';
import { displayAnswer } from './publication.js';
import type { LiveSessionAction, PrivateLiveSession, PrivateSlide } from './types.js';

function assertExpectedRevision(session: PrivateLiveSession, expectedRevision: number): void {
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
    throw new LiveSessionError('invalid-argument', 'expectedRevision must be a non-negative integer.');
  }
  if (session.revision !== expectedRevision) {
    throw new LiveSessionError('aborted', 'The live session changed; refresh and retry.');
  }
}

function assertMutable(session: PrivateLiveSession): void {
  if (session.status === 'ended') {
    throw new LiveSessionError('failed-precondition', 'The live session has ended.');
  }
}

export function applyLiveSessionAction(
  session: PrivateLiveSession,
  action: LiveSessionAction,
  expectedRevision: number,
  actorUid: string,
  now: unknown,
  slide?: PrivateSlide,
): PrivateLiveSession {
  assertExpectedRevision(session, expectedRevision);
  assertMutable(session);

  const revision = session.revision + 1;
  const common = { revision, updatedAt: now, updatedBy: actorUid };

  if (action.type === 'end-session') {
    return {
      ...session,
      ...common,
      status: 'ended',
      answerRevealed: false,
      endedAt: now,
    };
  }

  if (action.type === 'go-to-slide' || action.type === 'next-slide' || action.type === 'previous-slide') {
    const position = action.type === 'go-to-slide'
      ? action.position
      : session.currentSlidePosition + (action.type === 'next-slide' ? 1 : -1);
    if (!Number.isInteger(position) || position < 1 || position > session.slideCount) {
      throw new LiveSessionError('invalid-argument', 'Slide position is outside the quiz range.');
    }
    if (slide === undefined || slide.position !== position || slide.id !== action.slideId) {
      throw new LiveSessionError('failed-precondition', 'The requested slide is unavailable.');
    }
    return {
      ...session,
      ...common,
      status: 'active',
      currentSlidePosition: position,
      currentSlideId: slide.id,
      answerRevealed: false,
      startedAt: session.startedAt ?? now,
    };
  }

  if (session.status !== 'active' || slide === undefined
    || slide.position !== session.currentSlidePosition || slide.id !== session.currentSlideId) {
    throw new LiveSessionError('failed-precondition', 'There is no active slide.');
  }

  if (action.type === 'reveal-answer') {
    if (!slide.isQuestion || displayAnswer(slide.correctAnswer) === undefined) {
      throw new LiveSessionError('failed-precondition', 'This slide has no displayable answer.');
    }
    return { ...session, ...common, answerRevealed: true };
  }

  return { ...session, ...common, answerRevealed: false };
}
