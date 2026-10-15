import { parseQuizAsset, normalizeShowPreferences, type ShowPreferences } from '@filmovy-kviz/quiz-domain';
import { accessCall } from '../access/api';
import { getFirebaseAppContext } from '../../services/firebase/app';
import { getFirebaseAuth } from '../../services/firebase/auth';
export interface EventShowConfiguration { eventId: string; revision: number; preferences: ShowPreferences }
export async function readEventShowPreferences(eventId: string): Promise<EventShowConfiguration> {
  const data = await accessCall<EventShowConfiguration>('readEventShowPreferences', { eventId });
  return { ...data, preferences: normalizeShowPreferences(data.preferences) };
}
export async function configureEventShow(eventId: string, expectedRevision: number, preferences: ShowPreferences): Promise<EventShowConfiguration> {
  const data = await accessCall<EventShowConfiguration>('configureEventShow', { eventId, expectedRevision, preferences });
  return { ...data, preferences: normalizeShowPreferences(data.preferences) };
}
export async function readEventShowAudio(eventId: string, reference: string, signal: AbortSignal): Promise<Blob> {
  if (!parseQuizAsset(reference)) throw new Error('Vyberte ověřené médium.');
  const { config } = getFirebaseAppContext(), projectId = config.options.projectId;
  const endpoint = config.useEmulators ? `http://127.0.0.1:5001/${projectId}/europe-west1/readQuizMedia` : `https://europe-west1-${projectId}.cloudfunctions.net/readQuizMedia`;
  const url = new URL(endpoint); url.searchParams.set('eventId', eventId); url.searchParams.set('reference', reference);
  const user = getFirebaseAuth().currentUser;
  if (!user) throw new Error('Přihlášení je vyžadováno.');
  const token = await user.getIdToken();
  if (signal.aborted) throw new DOMException('Zrušeno.', 'AbortError');
  const response = await fetch(url, { headers: { Authorization: 'Bearer ' + token }, signal, cache: 'no-store' });
  if (!response.ok) throw new Error('Zvuk není dostupný pro tuto akci.');
  const blob = await response.blob();
  if (!['audio/mpeg', 'audio/wav'].includes(blob.type) || blob.size > 25 * 1024 * 1024) throw new Error('Neplatný zvukový soubor.');
  return blob;
}
