import { FunctionsError, httpsCallable } from 'firebase/functions';

import { getFirebaseServices } from '../../services/firebase/client';
import type { EventFormValues, EventMutationResponse } from './types';

function eventPayload(values: EventFormValues): Record<string, unknown> {
  return {
    title: values.title,
    startsAt: new Date(values.startsAt).toISOString(),
    timeZone: values.timeZone,
    venue: { name: values.venueName, publicLocation: values.publicLocation },
    teamCapacity: values.teamCapacity,
    peopleCapacity: values.peopleCapacity,
    teamSizeMin: values.teamSizeMin,
    teamSizeMax: values.teamSizeMax,
  };
}

async function invoke(name: string, data: Record<string, unknown>): Promise<EventMutationResponse> {
  return (await httpsCallable<Record<string, unknown>, EventMutationResponse>(
    getFirebaseServices().functions,
    name,
  )(data)).data;
}

export const createEvent = (values: EventFormValues) => invoke('createEvent', {
  expectedRevision: 0,
  event: eventPayload(values),
});

export const updateEvent = (eventId: string, revision: number, values: EventFormValues) => invoke('updateEvent', {
  eventId,
  expectedRevision: revision,
  event: eventPayload(values),
});

export const cancelEvent = (eventId: string, revision: number) => invoke('cancelEvent', {
  eventId,
  expectedRevision: revision,
});

export const archiveEvent = (eventId: string, revision: number) => invoke('archiveEvent', {
  eventId,
  expectedRevision: revision,
});

export const lockEventQuiz = (
  eventId: string,
  eventRevision: number,
  quizId: string,
  quizRevision: number,
  acknowledgeWarnings: boolean,
) => invoke('lockEventQuiz', {
  eventId,
  expectedRevision: eventRevision,
  quizId,
  expectedQuizRevision: quizRevision,
  acknowledgeWarnings,
});

export function eventActionError(error: unknown): string {
  if (error instanceof FunctionsError) {
    if (error.code === 'functions/aborted') return 'Data se mezitím změnila. Načtěte stránku znovu.';
    if (error.code === 'functions/permission-denied') return 'K této změně nemáte oprávnění.';
    if (error.code === 'functions/failed-precondition') return error.message;
  }
  return 'Akci se nepodařilo uložit. Zkuste to prosím znovu.';
}
