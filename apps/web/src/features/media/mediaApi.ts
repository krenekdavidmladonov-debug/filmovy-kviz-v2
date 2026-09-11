import { collection, getDocsFromServer, limit, query } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { ref, uploadBytesResumable } from 'firebase/storage';
import { parseQuizAsset, validOwnedMedia, type OwnedMediaKind } from '@filmovy-kviz/quiz-domain';
import { getFirebaseServices } from '../../services/firebase/client';
import { getFirebaseAppContext } from '../../services/firebase/app';
import { getFirebaseAuth } from '../../services/firebase/auth';
export async function listQuizMedia(quizId: string, kind: OwnedMediaKind): Promise<{ reference: string; size: number }[]> {
  const result = await getDocsFromServer(query(collection(getFirebaseServices().db, 'quizzes', quizId, 'mediaAssets'), limit(200)));
  return result.docs.flatMap(doc => { const d = doc.data(); return d.status === 'ready' && d.quizId === quizId && d.kind === kind && typeof d.generation === 'string' && validOwnedMedia(d.kind, d.contentType, d.size) ? [{ reference: 'quiz-asset:' + quizId + '/' + doc.id, size: d.size as number }] : []; });
}
export async function uploadQuizMedia(quizId: string, kind: OwnedMediaKind, file: File, options: { signal: AbortSignal; onProgress: (percent: number) => void }): Promise<string> {
  const contentType = file.type === 'audio/x-wav' ? 'audio/wav' : file.type;
  if (!validOwnedMedia(kind, contentType, file.size)) throw new Error('Použijte PNG/JPEG/WebP do 10 MiB nebo MP3/WAV do 25 MiB.');
  const services = getFirebaseServices();
  const check = () => { if (options.signal.aborted) throw new Error('Nahrávání bylo zrušeno.'); };
  check();
  try {
    const begin = (await httpsCallable<object, { assetId: string; path: string }>(services.functions, 'beginQuizMediaUpload', { timeout: 30000 })({ quizId, requestId: crypto.randomUUID(), kind, contentType, size: file.size })).data;
    check();
    const task = uploadBytesResumable(ref(services.storage, begin.path), file, { contentType });
    const transferTimeout = window.setTimeout(() => { task.cancel(); }, 120000);
    const cancel = () => { task.cancel(); }; options.signal.addEventListener('abort', cancel, { once: true });
    try { await new Promise<void>((resolve, reject) => task.on('state_changed', snapshot => options.onProgress(Math.round(snapshot.bytesTransferred * 100 / snapshot.totalBytes)), reject, resolve)); }
    finally { window.clearTimeout(transferTimeout); options.signal.removeEventListener('abort', cancel); }
    check();
    const ready = (await httpsCallable<object, { reference: string }>(services.functions, 'finalizeQuizMediaUpload', { timeout: 30000 })({ quizId, assetId: begin.assetId })).data;
    check();
    if (parseQuizAsset(ready.reference)?.quizId !== quizId) throw new Error('Neplatná odpověď serveru.');
    return ready.reference;
  } catch (error) {
    check();
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
    if (code.includes('failed-precondition')) throw new Error('Server odmítl obsah souboru. Ověřte skutečný formát, velikost a zkuste jiný soubor.', { cause: error });
    if (code.includes('permission-denied') || code.includes('unauthorized')) throw new Error('Nahrávání není povoleno. Je potřeba admin oprávnění a dostupné úložiště.', { cause: error });
    throw new Error('Přenos nebo ověření média selhalo. Rozepsaný obsah zůstal zachovaný. Zkuste nahrát znovu.', { cause: error });
  }
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
