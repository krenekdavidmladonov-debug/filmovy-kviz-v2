import { httpsCallable } from 'firebase/functions';

import { getFirebaseServices } from '../../services/firebase/client';
import type { LiveActionResponse } from './types';

async function invoke(name: string, data: Record<string, unknown>): Promise<LiveActionResponse> {
  const callable = httpsCallable<Record<string, unknown>, LiveActionResponse>(getFirebaseServices().functions, name);
  return (await callable(data)).data;
}

export function createLiveSession(quizId: string): Promise<LiveActionResponse> {
  return invoke('createLiveSession', { quizId });
}

function revisionAction(name: string) {
  return (sessionId: string, expectedRevision: number) => invoke(name, { sessionId, expectedRevision });
}

export const nextSlide = revisionAction('nextSlide');
export const previousSlide = revisionAction('previousSlide');
export const revealAnswer = revisionAction('revealAnswer');
export const hideAnswer = revisionAction('hideAnswer');
export const playMedia = revisionAction('playMedia');
export const stopMedia = revisionAction('stopMedia');
export const replayMedia = revisionAction('replayMedia');
export const startIntro = revisionAction('startIntro');
export const endLiveSession = revisionAction('endLiveSession');

export function goToSlide(sessionId: string, expectedRevision: number, position: number): Promise<LiveActionResponse> {
  return invoke('goToSlide', { sessionId, expectedRevision, position });
}

export function selectRecapQuestion(sessionId: string, expectedRevision: number, position: number): Promise<LiveActionResponse> {
  return invoke('selectRecapQuestion', { sessionId, expectedRevision, position });
}

export function finishMedia(
  sessionId: string,
  expectedRevision: number,
  mediaGeneration: number,
): Promise<LiveActionResponse> {
  return invoke('finishMedia', { sessionId, expectedRevision, mediaGeneration });
}
