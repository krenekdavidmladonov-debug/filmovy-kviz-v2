import { httpsCallable } from 'firebase/functions';
import { ref, uploadBytes } from 'firebase/storage';
import { parseQuizAsset, validOwnedMedia, type OwnedMediaKind } from '@filmovy-kviz/quiz-domain';
import { getFirebaseServices } from '../../services/firebase/client';
import { getFirebaseAppContext } from '../../services/firebase/app';
import { getFirebaseAuth } from '../../services/firebase/auth';
export async function uploadQuizMedia(quizId: string, kind: OwnedMediaKind, file: File): Promise<string> {
  const contentType = file.type === 'audio/x-wav' ? 'audio/wav' : file.type;
  if (!validOwnedMedia(kind, contentType, file.size)) throw new Error('Použijte PNG/JPEG/WebP do 10 MiB nebo MP3/WAV do 25 MiB.');
  const services = getFirebaseServices();
  const begin = (await httpsCallable<object, { assetId: string; path: string }>(services.functions, 'beginQuizMediaUpload')({ quizId, requestId: crypto.randomUUID(), kind, contentType, size: file.size })).data;
  await uploadBytes(ref(services.storage, begin.path), file, { contentType });
  const ready = (await httpsCallable<object, { reference: string }>(services.functions, 'finalizeQuizMediaUpload')({ quizId, assetId: begin.assetId })).data;
  return ready.reference;
}
export async function readQuizMediaBlob(reference: string, signal: AbortSignal, sessionId?: string): Promise<Blob> {
  if (!parseQuizAsset(reference)) throw new Error('Invalid asset reference');
  const { config } = getFirebaseAppContext(), projectId = config.options.projectId;
  const endpoint = config.useEmulators ? 'http://127.0.0.1:5001/' + projectId + '/europe-west1/readQuizMedia' : 'https://europe-west1-' + projectId + '.cloudfunctions.net/readQuizMedia';
  const url = new URL(endpoint); url.searchParams.set('reference', reference);
  const headers: Record<string, string> = {};
  if (sessionId) url.searchParams.set('sessionId', sessionId);
  else {
    const user = getFirebaseAuth().currentUser;
    if (!user) throw new Error('Přihlášení je vyžadováno.');
    headers.Authorization = 'Bearer ' + await user.getIdToken();
  }
  const response = await fetch(url, { headers, signal, cache: 'no-store' });
  if (!response.ok) throw new Error('Médium není dostupné.');
  return response.blob();
}
