import { LiveSessionError } from './errors.js';
import { displayAnswer } from './publication.js';
import type { LiveSessionAction, PrivateLiveSession, PrivateSlide } from './types.js';

function assertExpectedRevision(session: PrivateLiveSession, expectedRevision: number): void {
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
    throw new LiveSessionError('invalid-argument', 'expectedRevision must be a non-negative integer.');
  }
  if (session.revision !== expectedRevision) throw new LiveSessionError('aborted', 'The live session changed; refresh and retry.');
}

function assertMutable(session: PrivateLiveSession): void {
  if (session.status === 'ended') throw new LiveSessionError('failed-precondition', 'The live session has ended.');
}

function isRecapKind(kind: string): boolean {
  return kind.toLowerCase() === 'recap';
}

function isIntroKind(kind: string): boolean {
  return ['intro', 'round', 'roundheader', 'round-header', 'section'].includes(kind.toLowerCase());
}

function isMediaKind(kind: string): boolean {
  return ['audio', 'music', 'video', 'youtube'].includes(kind.toLowerCase());
}

function withoutRecapSelection(session: PrivateLiveSession): PrivateLiveSession {
  const { recapQuestionPosition, recapQuestionId, ...clean } = session;
  void recapQuestionPosition;
  void recapQuestionId;
  return clean;
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
  const common = { revision: session.revision + 1, updatedAt: now, updatedBy: actorUid };
  if (action.type === 'end-session') {
    return {
      ...withoutRecapSelection(session), ...common, status: 'ended', answerRevealed: false, presentationMode: 'slide',
      mediaCommand: 'idle', mediaGeneration: session.mediaGeneration + 1, endedAt: now,
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
    const recap = isRecapKind(slide.kind);
    return {
      ...withoutRecapSelection(session),
      ...common,
      status: 'active',
      currentSlidePosition: position,
      currentSlideId: slide.id,
      answerRevealed: false,
      presentationMode: recap ? 'recap' : 'slide',
      mediaCommand: 'idle',
      mediaGeneration: session.mediaGeneration + 1,
      startedAt: session.startedAt ?? now,
    };
  }
  if (session.status !== 'active' || slide === undefined) {
    throw new LiveSessionError('failed-precondition', 'There is no active slide.');
  }
  if (action.type === 'select-recap-question') {
    if (session.presentationMode !== 'recap' || !slide.isQuestion || slide.position !== action.position
      || slide.id !== action.slideId || displayAnswer(slide.correctAnswer, slide.kind) === undefined) {
      throw new LiveSessionError('failed-precondition', 'The requested recap question is unavailable.');
    }
    return {
      ...session, ...common, answerRevealed: true,
      recapQuestionPosition: slide.position, recapQuestionId: slide.id,
      mediaCommand: 'idle', mediaGeneration: session.mediaGeneration + 1,
    };
  }
  const expectedPosition = session.presentationMode === 'recap'
    ? session.recapQuestionPosition
    : session.currentSlidePosition;
  const expectedId = session.presentationMode === 'recap' ? session.recapQuestionId : session.currentSlideId;
  if (slide.position !== expectedPosition || slide.id !== expectedId) {
    throw new LiveSessionError('failed-precondition', 'The active presentation slide is unavailable.');
  }
  if (action.type === 'reveal-answer') {
    if (session.presentationMode !== 'slide' || !slide.isQuestion || displayAnswer(slide.correctAnswer, slide.kind) === undefined) {
      throw new LiveSessionError('failed-precondition', 'This slide has no displayable answer.');
    }
    return { ...session, ...common, answerRevealed: true };
  }
  if (action.type === 'hide-answer') return { ...session, ...common, answerRevealed: false };
  if (action.type === 'start-intro') {
    if (!isIntroKind(slide.kind) || session.presentationMode !== 'slide') {
      throw new LiveSessionError('failed-precondition', 'The current slide has no intro animation.');
    }
    return { ...session, ...common, introGeneration: session.introGeneration + 1 };
  }
  if (!isMediaKind(slide.kind)) throw new LiveSessionError('failed-precondition', 'The current slide has no playable media.');
  const command = action.type === 'play-media' ? 'play'
    : action.type === 'replay-media' ? 'replay'
      : action.type === 'stop-media' ? 'stop'
        : action.type === 'finish-media' ? 'finished'
          : undefined;
  if (command === undefined) throw new LiveSessionError('invalid-argument', 'Unsupported live action.');
  return { ...session, ...common, mediaCommand: command, mediaGeneration: session.mediaGeneration + 1 };
}
