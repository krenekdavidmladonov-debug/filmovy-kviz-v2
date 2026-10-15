import { useEffect, useRef, useState } from 'react';
import { listQuizMedia, uploadQuizMedia } from '../media/mediaApi';

/** Reuses the protected quiz upload grant/library APIs, deliberately has no URL mode. */
export function ShowAudioAssetPicker({ quizId, label, value, disabled, canUpload, onChange, onPending }: {
  quizId: string; label: string; value?: string; disabled: boolean; canUpload: boolean;
  onChange: (reference: string | undefined) => void; onPending: (pending: boolean) => void;
}) {
  const [items, setItems] = useState<Awaited<ReturnType<typeof listQuizMedia>>>([]);
  const [open, setOpen] = useState(false), [pending, setPending] = useState(false), [error, setError] = useState('');
  const [progress, setProgress] = useState(0);
  const input = useRef<HTMLInputElement>(null), abort = useRef<AbortController | null>(null), epoch = useRef(0);
  const onPendingRef = useRef(onPending); onPendingRef.current = onPending;
  useEffect(() => () => { epoch.current++; abort.current?.abort(); onPendingRef.current(false); }, []);
  async function library() {
    const run = ++epoch.current; setError(''); setPending(true); onPendingRef.current(true);
    try { const next = await listQuizMedia(quizId, 'audio'); if (run === epoch.current) { setItems(next); setOpen(true); } }
    catch { if (run === epoch.current) setError('Média kvízu se nepodařilo načíst.'); }
    finally { if (run === epoch.current) { setPending(false); onPendingRef.current(false); } }
  }
  async function upload(file: File) {
    abort.current?.abort(); const controller = new AbortController(); abort.current = controller;
    const run = ++epoch.current; setPending(true); onPendingRef.current(true); setError(''); setProgress(0);
    try {
      const reference = await uploadQuizMedia(quizId, 'audio', file, { signal: controller.signal, onProgress: setProgress });
      if (run === epoch.current && !controller.signal.aborted) { onChange(reference); setOpen(false); }
    } catch (failure) { if (run === epoch.current) setError(failure instanceof Error ? failure.message : 'Nahrávání selhalo.'); }
    finally { if (run === epoch.current) { setPending(false); onPendingRef.current(false); } }
  }
  return <fieldset className="show-audio-picker" disabled={disabled}>
    <legend>{label}</legend>
    <p>{value ? 'Přiřazený ověřený soubor' : 'Bez zvuku'}</p>
    <div className="show-audio-actions">
      <button type="button" className="secondary-button" disabled={pending || !canUpload} onClick={() => input.current?.click()}>Nahrát MP3/WAV</button>
      <button type="button" className="secondary-button" disabled={pending} onClick={() => void library()}>Vybrat z médií kvízu</button>
      {value && <button type="button" className="secondary-button" disabled={pending} onClick={() => onChange(undefined)}>Odebrat</button>}
    </div>
    <input ref={input} hidden type="file" accept="audio/mpeg,audio/wav,audio/x-wav,.mp3,.wav" aria-label={label + ' — soubor'} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file && canUpload && !disabled) void upload(file); }} />
    {pending && <div role="status">Načítání / ověření média {progress > 0 ? progress + ' %' : ''}<button type="button" className="secondary-button" onClick={() => { epoch.current++; abort.current?.abort(); setPending(false); onPendingRef.current(false); }}>Zrušit</button></div>}
    {open && <div className="show-audio-library">{items.length ? items.map((item, index) => <button type="button" className="secondary-button" key={item.reference} onClick={() => { onChange(item.reference); setOpen(false); }}>Zvuk {index + 1} · {Math.ceil(item.size / 1024)} KiB</button>) : <p>Zatím žádný ověřený MP3/WAV soubor.</p>}</div>}
    {error && <p role="alert">{error}</p>}
  </fieldset>;
}
