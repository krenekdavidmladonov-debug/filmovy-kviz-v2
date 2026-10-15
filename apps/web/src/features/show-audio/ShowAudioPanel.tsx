import { useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { defaultShowPreferences, normalizeShowPreferences, showAudioCues, type ShowAudioCue, type ShowPreferences } from '@filmovy-kviz/quiz-domain';
import { getFirebaseAuth } from '../../services/firebase/auth';
import { configureEventShow, readEventShowAudio, readEventShowPreferences } from './api';
import { ShowAudioController, type ShowAudioState } from './controller';
import { ShowAudioAssetPicker } from './ShowAudioAssetPicker';
import './show-audio.css';

const labels: Record<ShowAudioCue, string> = { intro: 'Úvod', interim: 'Průběžné výsledky', suspense: 'Napětí', reveal: 'Odhalení', winner: 'Vítězové' };
export interface ShowAudioPanelProps {
  eventId: string; quizId: string; canUpload?: boolean; canAttach?: boolean;
  canPlay?: () => boolean;
  onPreferencesChange?: (preferences: ShowPreferences) => void;
  onController?: (controller: ShowAudioController | null) => void;
}
export function ShowAudioPanel({ eventId, quizId, canUpload = false, canAttach = true, canPlay, onPreferencesChange, onController }: ShowAudioPanelProps) {
  const [preferences, setPreferences] = useState<ShowPreferences>(() => normalizeShowPreferences(undefined));
  const preferencesRef = useRef<ShowPreferences>({ ...defaultShowPreferences, cues: {} });
  const [draft, setDraft] = useState(preferences), [dirty, setDirty] = useState(false), [revision, setRevision] = useState(0);
  const dirtyRef = useRef(false), authorized = useRef(false), canPlayRef = useRef(canPlay);
  const revisionRef = useRef(0);
  const lifecycle = useRef(0), identityEpoch = useRef(0);
  const onPreferencesRef = useRef(onPreferencesChange), onControllerRef = useRef(onController);
  canPlayRef.current = canPlay; onPreferencesRef.current = onPreferencesChange; onControllerRef.current = onController;
  const [audio, setAudio] = useState<ShowAudioState>({ status: 'idle' }), [error, setError] = useState(''), [saving, setSaving] = useState(false);
  const [saveState, setSaveState] = useState<'loading' | 'ready' | 'dirty' | 'saving' | 'saved' | 'error'>('loading');
  const [pickerEpoch, setPickerEpoch] = useState(0);
  const [pendingCues, setPendingCues] = useState<Set<ShowAudioCue>>(() => new Set());
  const controllerRef = useRef<ShowAudioController | null>(null);
  // This stable UI facade owns no resource. Every effect setup acquires a new controller.
  const controller = useMemo(() => ({
    stopImmediate: () => controllerRef.current?.stopImmediate(),
    stop: () => controllerRef.current?.stop(),
    updateVolume: () => controllerRef.current?.updateVolume(),
    prepareGesture: () => controllerRef.current?.prepareGesture() ?? -1,
    playCue: (cue: ShowAudioCue, token: number) => controllerRef.current?.playCue(cue, token),
  }), []);
  useEffect(() => {
    const controller = new ShowAudioController({
      preferences: () => preferencesRef.current,
      read: (reference, signal) => readEventShowAudio(eventId, reference, signal),
      changed: setAudio,
      allowed: () => authorized.current && navigator.onLine && canPlayRef.current?.() !== false,
    });
    controllerRef.current = controller;
    let active = true, refreshing = false, timer: ReturnType<typeof setTimeout>;
    lifecycle.current++; revisionRef.current = 0; authorized.current = false;
    const refresh = async () => {
      if (!active || refreshing) return;
      refreshing = true; clearTimeout(timer);
      const identity = identityEpoch.current;
      try {
        const current = await readEventShowPreferences(eventId);
        if (!active || identity !== identityEpoch.current || current.revision < revisionRef.current || !navigator.onLine) return;
        revisionRef.current = current.revision;
        const previous = preferencesRef.current;
        if (JSON.stringify(previous.cues) !== JSON.stringify(current.preferences.cues) || !current.preferences.audioEnabled) controller.stopImmediate();
        authorized.current = true;
        setError(previous => previous.startsWith('Nastavení není dostupné.') ? '' : previous);
        preferencesRef.current = dirtyRef.current ? { ...current.preferences, volume: previous.volume, audioEnabled: previous.audioEnabled } : current.preferences;
        setPreferences(current.preferences); controller.updateVolume();
        if (!dirtyRef.current) { setDraft(current.preferences); setRevision(current.revision); }
        setSaveState(previous => previous === 'loading' ? 'ready' : previous);
        onPreferencesRef.current?.(current.preferences);
      } catch {
        if (active && identity === identityEpoch.current) { authorized.current = false; controller.stopImmediate(); setError('Nastavení není dostupné. Ověřte připojení a oprávnění, pak načtěte panel znovu.'); }
      } finally { refreshing = false; if (active) timer = setTimeout(() => void refresh(), identity === identityEpoch.current ? 2000 : 0); }
    };
    void refresh(); onControllerRef.current?.(controller);
    const unAuth = onAuthStateChanged(getFirebaseAuth(), () => {
      identityEpoch.current++; authorized.current = false; controller.stopImmediate();
      setPickerEpoch(value => value + 1);
      dirtyRef.current = false; setDirty(false); setSaving(false); setSaveState('loading');
      revisionRef.current = 0; setRevision(0);
      const defaults = normalizeShowPreferences(undefined);
      preferencesRef.current = defaults; setPreferences(defaults); setDraft(defaults);
      void refresh();
    });
    const offline = () => { authorized.current = false; controller.stopImmediate(); };
    window.addEventListener('offline', offline);
    return () => {
      active = false; lifecycle.current++; clearTimeout(timer); unAuth(); window.removeEventListener('offline', offline); authorized.current = false;
      controller.dispose();
      if (controllerRef.current === controller) { controllerRef.current = null; onControllerRef.current?.(null); }
    };
  }, [eventId]);
  const change = (next: ShowPreferences) => { dirtyRef.current = true; setDirty(true); setDraft(next); setSaveState('dirty'); };
  async function save() {
    const generation = lifecycle.current, identity = identityEpoch.current;
    const valid = () => generation === lifecycle.current && identity === identityEpoch.current;
    controller.stopImmediate(); setSaving(true); setSaveState('saving'); setError('');
    try {
      const saved = await configureEventShow(eventId, revision, draft);
      if (!valid()) return;
      revisionRef.current = saved.revision;
      preferencesRef.current = saved.preferences; setPreferences(saved.preferences); setDraft(saved.preferences); setRevision(saved.revision);
      dirtyRef.current = false; setDirty(false); authorized.current = true; setSaveState('saved'); onPreferencesRef.current?.(saved.preferences);
    } catch (failure) { if (valid()) { setSaveState('error'); setError(failure instanceof Error ? failure.message : 'Nastavení se nepodařilo uložit.'); } }
    finally { if (valid()) setSaving(false); }
  }
  const blockedByMedia = canPlay?.() === false;
  return <section className="show-audio-panel" aria-label="Zvuk show mode" data-save-state={saveState}>
    <header><h3>Zvuk vyhlášení</h3><button type="button" className="danger-button" onClick={controller.stopImmediate}>STOP zvuku</button></header>
    <p role="status">{audio.status === 'playing' ? 'Přehrává se: ' + labels[audio.cue!] : audio.status === 'loading' ? 'Načítám a dekóduji zvuk…' : audio.message || 'Zvuk nehraje.'}</p>
    {blockedByMedia && <p>Nejprve zastavte médium otázky. Zvuk show se současně nespouští.</p>}
    <div className="show-audio-actions">{showAudioCues.map(cue => <button type="button" className="secondary-button" key={cue} disabled={!preferences.audioEnabled || !preferences.cues[cue] || preferences.volume === 0 || blockedByMedia || !authorized.current} onClick={() => { const token = controller.prepareGesture(); void controller.playCue(cue, token); }}>Přehrát: {labels[cue]}</button>)}<button type="button" className="secondary-button" onClick={controller.stop}>Plynule zastavit</button></div>
    <details><summary>Nastavení SHOW MODE a vlastní MP3/WAV</summary>
      <fieldset disabled={saving || !revision}>
        <label>Animace<select aria-label="Intenzita animací SHOW MODE" value={draft.motion} onChange={e => change({ ...draft, motion: e.target.value as ShowPreferences['motion'] })}><option value="none">Bez animací</option><option value="subtle">Jemné</option><option value="show">Show</option></select></label>
        <label>Nižší pořadí<select aria-label="Odhalování nižších pořadí" value={draft.lowerRanks} onChange={e => change({ ...draft, lowerRanks: e.target.value as ShowPreferences['lowerRanks'] })}><option value="step">Po jednom umístění</option><option value="bulk">Společně</option></select></label>
        <label><input type="checkbox" checked={draft.topThree} onChange={e => change({ ...draft, topThree: e.target.checked })} /> Animace 2. a 3. místa</label>
        <label><input type="checkbox" checked={draft.winnerAnimation} onChange={e => change({ ...draft, winnerAnimation: e.target.checked })} /> Animace vítězů</label>
        <label><input type="checkbox" checked={draft.audioEnabled} onChange={e => { if (!e.target.checked) controller.stopImmediate(); preferencesRef.current = { ...preferencesRef.current, audioEnabled: e.target.checked }; change({ ...draft, audioEnabled: e.target.checked }); }} /> Povolit zvuk</label>
        <label>Hlasitost {Math.round(draft.volume * 100)} %<input type="range" min="0" max="1" step="0.01" value={draft.volume} onChange={e => { const volume = Number(e.target.value); change({ ...draft, volume }); preferencesRef.current = { ...preferencesRef.current, volume }; controller.updateVolume(); }} /></label>
        <label>Náběh (ms)<input type="number" min="0" max="2000" step="50" value={draft.fadeInMs} onChange={e => change({ ...draft, fadeInMs: Number(e.target.value) })} /></label>
        <label>Doznění (ms)<input type="number" min="0" max="2000" step="50" value={draft.fadeOutMs} onChange={e => change({ ...draft, fadeOutMs: Number(e.target.value) })} /></label>
      </fieldset>
      <div className="show-audio-pickers">{showAudioCues.map(cue => <ShowAudioAssetPicker key={`${quizId}-${cue}-${pickerEpoch}`} quizId={quizId} label={labels[cue]} value={draft.cues[cue]} disabled={saving || !canAttach || !revision} canUpload={canUpload} onPending={pending => setPendingCues(current => { const next = new Set(current); if (pending) next.add(cue); else next.delete(cue); return next; })} onChange={reference => { const cues = { ...draft.cues }; if (reference) cues[cue] = reference; else delete cues[cue]; change({ ...draft, cues }); }} />)}</div>
      <button type="button" className="primary-button" disabled={!dirty || saving || !revision || pendingCues.size > 0} onClick={() => void save()}>Uložit nastavení show</button>
      <button type="button" className="secondary-button" disabled={saving} onClick={() => { dirtyRef.current = false; setDirty(false); preferencesRef.current = preferences; controller.updateVolume(); setDraft(preferences); setError(''); setSaveState('ready'); }}>Zahodit změny / načíst aktuální</button>
      {saveState === 'saved' && <p role="status">Nastavení show uloženo.</p>}
      <p>Soubor se přiřadí až po uložení. Přehrávání potvrzujeme až po dekódování a spuštění zvukového výstupu. Automatický cue spouští pouze čerstvá moderátorská akce.</p>
    </details>
    {error && <p role="alert">{error}</p>}
  </section>;
}
