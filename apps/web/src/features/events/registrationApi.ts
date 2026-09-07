import { FunctionsError, httpsCallable } from 'firebase/functions';

import { getFirebaseServices } from '../../services/firebase/client';
import type { RegistrationMutationResponse } from './types';

export interface RegistrationFormValues {
  readonly teamName: string;
  readonly memberCount: number;
  readonly contactEmail: string;
}
async function invoke<T>(name: string, data: Record<string, unknown>): Promise<T> {
  return (await httpsCallable<Record<string, unknown>, T>(getFirebaseServices().functions, name)(data)).data;
}

export function configureEventRegistration(
  eventId: string,
  expectedRevision: number,
  registrationOpensAt: string,
  registrationClosesAt: string,
  published: boolean,
) {
  return invoke<{ eventId: string; revision: number; registrationStatus: string }>('configureEventRegistration', {
    eventId,
    expectedRevision,
    registrationOpensAt: new Date(registrationOpensAt).toISOString(),
    registrationClosesAt: new Date(registrationClosesAt).toISOString(),
    published,
  });
}

export function createEventRegistration(eventId: string, values: RegistrationFormValues) {
  return invoke<RegistrationMutationResponse>('createEventRegistration', { eventId, ...values });
}

export function getManagedRegistration(eventId: string, registrationId: string, token: string) {
  return invoke<RegistrationMutationResponse>('getEventRegistration', { eventId, registrationId, token });
}

export function updateManagedRegistration(eventId: string, registrationId: string, token: string, values: RegistrationFormValues) {
  return invoke<RegistrationMutationResponse>('updateEventRegistration', { eventId, registrationId, token, ...values });
}

export function cancelManagedRegistration(eventId: string, registrationId: string, token: string) {
  return invoke<RegistrationMutationResponse>('cancelEventRegistration', { eventId, registrationId, token });
}

export function adminCancelRegistration(eventId: string, registrationId: string) {
  return invoke<RegistrationMutationResponse>('adminCancelEventRegistration', { eventId, registrationId });
}

export function registrationActionError(error: unknown): string {
  if (error instanceof FunctionsError) {
    if (error.code === 'functions/already-exists') return 'Tým s tímto názvem už je na akci přihlášený.';
    if (error.code === 'functions/resource-exhausted') return 'Kapacita akce už nestačí pro tento tým.';
    if (error.code === 'functions/not-found') return 'Registrace nebo bezpečný odkaz nejsou platné.';
    if (error.code === 'functions/permission-denied') return 'Tuto operaci nelze provést v přihlášené staff relaci.';
    if (error.code === 'functions/failed-precondition' || error.code === 'functions/invalid-argument') return error.message;
  }
  return 'Registraci se nepodařilo uložit. Zkuste to znovu.';
}
