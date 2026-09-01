import { httpsCallable } from 'firebase/functions';

import { getFirebaseServices } from '../../services/firebase/client';
import type { LiveActionResponse } from './types';

function callable(name: string) {
  return httpsCallable<Record<string, unknown>, LiveActionResponse>(getFirebaseServices().functions, name);
}

export async function createLiveSession(quizId: string): Promise<LiveActionResponse> {
  return (await callable('createLiveSession')({ quizId })).data;
}

async function mutate(
  name: string,
  sessionId: string,
  expectedRevision: number,
  extra: Record<string, unknown> = {},
): Promise<LiveActionResponse> {
  return (await callable(name)({ sessionId, expectedRevision, ...extra })).data;
}

export const nextSlide = (sessionId: string, expectedRevision: number) => (
  mutate('nextSlide', sessionId, expectedRevision)
);
export const previousSlide = (sessionId: string, expectedRevision: number) => (
  mutate('previousSlide', sessionId, expectedRevision)
);
export const revealAnswer = (sessionId: string, expectedRevision: number) => (
  mutate('revealAnswer', sessionId, expectedRevision)
);
export const hideAnswer = (sessionId: string, expectedRevision: number) => (
  mutate('hideAnswer', sessionId, expectedRevision)
);
export const endLiveSession = (sessionId: string, expectedRevision: number) => (
  mutate('endLiveSession', sessionId, expectedRevision)
);
export const goToSlide = (sessionId: string, expectedRevision: number, position: number) => (
  mutate('goToSlide', sessionId, expectedRevision, { position })
);
