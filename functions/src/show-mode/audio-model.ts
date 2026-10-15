import { normalizeShowPreferences, parseQuizAsset, showAudioCues, validOwnedMedia, type ShowPreferences, type ShowAudioCue } from '@filmovy-kviz/quiz-domain';
import { HttpsError } from 'firebase-functions/v2/https';

export interface ShowAudioBinding { reference: string; generation: string }
export type ShowAudioBindings = Partial<Record<ShowAudioCue, ShowAudioBinding>>;
export function requestedShowPreferences(value: unknown): ShowPreferences {
  if (value === undefined) throw new HttpsError('invalid-argument', 'Chybí nastavení show.');
  try { return normalizeShowPreferences(value); }
  catch { throw new HttpsError('invalid-argument', 'Neplatné nastavení show.'); }
}
export function readyShowAudio(reference: string, asset: Record<string, unknown> | undefined): ShowAudioBinding {
  const parsed = parseQuizAsset(reference);
  if (!parsed || !asset || asset.quizId !== parsed.quizId || asset.status !== 'ready' || asset.kind !== 'audio'
    || !validOwnedMedia('audio', asset.contentType, asset.size) || typeof asset.generation !== 'string' || !/^\d+$/u.test(asset.generation)) {
    throw new HttpsError('failed-precondition', 'Vyberte ověřený MP3/WAV soubor.');
  }
  return { reference, generation: asset.generation };
}
/** Fail closed on removed/replaced cues, malformed metadata and generation changes. */
export function eventShowAudioAllowed(event: Record<string, unknown>, reference: string, asset: Record<string, unknown> | undefined): boolean {
  try {
    const preferences = normalizeShowPreferences(event.showPreferences), ready = readyShowAudio(reference, asset);
    const bindings = event.showAudioBindings as ShowAudioBindings | undefined;
    return showAudioCues.some(cue => preferences.cues[cue] === reference && bindings?.[cue]?.reference === reference && bindings[cue]?.generation === ready.generation);
  } catch { return false; }
}
