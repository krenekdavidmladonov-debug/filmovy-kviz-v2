import { teamEmailEnabled } from './teamEmailCapability';
import { FunctionsError, httpsCallable } from 'firebase/functions';
import { getFirebaseServices } from '../../services/firebase/client';

export interface TeamMessageCopy { subject: string; message: string }
export interface TeamMessagePreview extends TeamMessageCopy { eventTitle: string; total: number; previewFingerprint: string }
export interface TeamMessageReceipt extends TeamMessageCopy { campaignId: string; eventId: string; eventTitle: string; total: number; createdAt: string }
export interface TeamMessageStatus extends TeamMessageReceipt { pending: number; sent: number; failed: number }
export interface TeamMessageRequest extends TeamMessageCopy { eventId: string; requestId: string; previewFingerprint: string; confirmed: true }
const invoke = async <T>(name: string, data: object) => {
  if (!teamEmailEnabled) throw new Error('Týmové e-maily nejsou v tomto sestavení zapnuté.');
  return (await httpsCallable<object, T>(getFirebaseServices().functions, name)(data)).data;
};
export const previewTeamMessage = (eventId: string, copy: TeamMessageCopy) => invoke<TeamMessagePreview>('previewEventTeamMessage', { eventId, ...copy });
export const createTeamMessage = (data: TeamMessageRequest) => invoke<TeamMessageReceipt>('createEventTeamMessage', data);
export const listTeamMessages = (eventId: string) => invoke<TeamMessageReceipt[]>('listEventTeamMessages', { eventId });
export const getTeamMessage = (eventId: string, campaignId: string) => invoke<TeamMessageStatus>('getEventTeamMessage', { eventId, campaignId });
export const definitiveMessageError = (error: unknown) => error instanceof FunctionsError && ['invalid-argument', 'permission-denied', 'failed-precondition', 'resource-exhausted', 'aborted'].some(code => error.code === 'functions/' + code);
export const resetTeamMessageRequest = (error: unknown, recovering: boolean) => definitiveMessageError(error)
  && !(recovering && error instanceof FunctionsError && error.code === 'functions/permission-denied');
export function teamMessageError(error: unknown): string {
  if (definitiveMessageError(error) && error instanceof FunctionsError) return error.message;
  return 'Výsledek požadavku není potvrzen. Opakujte ověření stejného požadavku; nevytvářejte novou zprávu.';
}
