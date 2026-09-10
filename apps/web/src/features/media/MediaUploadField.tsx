import { useEffect, useRef, useState } from 'react';
import type { OwnedMediaKind } from '@filmovy-kviz/quiz-domain';
import { uploadQuizMedia } from './mediaApi';
export function MediaUploadField({ quizId, kind, disabled, onReady, onPending }: { quizId: string; kind: OwnedMediaKind; disabled: boolean; onReady: (reference: string) => void; onPending?: ((pending: boolean) => void) | undefined }) {
  const [pending, setPending] = useState(false), [error, setError] = useState(false);
  const active = useRef(true), callback = useRef(onReady);
  useEffect(() => { callback.current = onReady; }, [onReady]);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  return <div className="form-field"><label>{kind === 'image' ? 'Nahrát vlastní obrázek' : 'Nahrát vlastní audio'}
    <input type="file" disabled={disabled || pending} accept={kind === 'image' ? 'image/png,image/jpeg,image/webp' : 'audio/mpeg,audio/wav,.wav'} onChange={e => {
      const file = e.target.files?.[0]; if (!file) return;
      setPending(true); onPending?.(true); setError(false);
      void uploadQuizMedia(quizId, kind, file).then(reference => { if (active.current) callback.current(reference); }).catch(() => { if (active.current) setError(true); }).finally(() => { if (active.current) { setPending(false); onPending?.(false); } });
      e.target.value = '';
    }} /></label>
    <small>{kind === 'image' ? 'PNG, JPEG nebo WebP, nejvýše 10 MiB.' : 'MP3 nebo WAV, nejvýše 25 MiB.'} Přiřazení k otázce potvrďte tlačítkem Uložit.</small>
    {pending && <p role="status">Nahrávám a ověřuji soubor…</p>}{error && <p role="alert">Soubor se nepodařilo připravit. Ověřte jeho typ, velikost a připojení.</p>}
  </div>;
}
