import { useEffect, useRef, useState } from 'react';
import { collection, doc, getDocFromServer, onSnapshot, runTransaction } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import type { FinalRevealPage } from '@filmovy-kviz/quiz-domain';
import { getFirebaseServices } from '../../services/firebase/client';
import { getFirebaseFirestore } from '../../services/firebase/firestore';
import { mapLiveControlState } from '../live/liveMappers';
import type { LiveControlState } from '../live/types';
import type { ResultsPreview, ResultRow } from '../leaderboard/types';
import { ResultsTable } from '../leaderboard/ResultsTable';
import { FinalRevealView } from './FinalRevealView';
import { Fanfare, type FanfareStatus } from './fanfare';
import type { FinalResponse } from './types';

type Action = 'start' | 'replace' | 'reveal' | 'hide' | 'resume' | 'page' | 'table';
interface SavedVersion { versionId: string; rows: ResultRow[]; sourceFingerprint: string }
export function FinalRevealPanel({ session, ending = false }: { session: LiveControlState; ending?: boolean }) {
  const [preview, setPreview] = useState<ResultsPreview | null>(null), [previewPage, setPreviewPage] = useState(0);
  const [saved, setSaved] = useState<SavedVersion | null>(null), [changed, setChanged] = useState<boolean | null>(null);
  const [pending, setPending] = useState(false), [error, setError] = useState(''), [replaceConsent, setReplaceConsent] = useState(false);
  const [retry, setRetry] = useState<Record<string, unknown> | null>(null);
  const [soundStatus, setSoundStatus] = useState<FanfareStatus>('idle'), [volume, setVolume] = useState(.12), [muted, setMuted] = useState(false);
  const sound = useRef<Fanfare | null>(null), current = useRef(session), active = useRef(true), epoch = useRef(0), busy = useRef(false), endRef = useRef(ending);
  current.current = session; endRef.current = ending;
  const state = session.finalReveal, ended = session.status === 'ended';
  useEffect(() => {
    active.current = true; sound.current = new Fanfare(setSoundStatus);
    return () => { active.current = false; epoch.current++; sound.current?.dispose(); sound.current = null; };
  }, []);
  useEffect(() => { epoch.current++; sound.current?.stop(); }, [state?.versionId, state?.visible, ended, ending]);
  useEffect(() => { sound.current?.setVolume(volume, muted); }, [volume, muted]);
  useEffect(() => {
    let valid = true, generation = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setSaved(null); setChanged(null);
    if (!state?.versionId || ended) return;
    const db = getFirebaseFirestore(), versionId = state.versionId;
    const check = () => {
      clearTimeout(timer);
      const attempt = ++generation;
      timer = setTimeout(() => {
        void Promise.all([
          getDocFromServer(doc(db, 'sessions', session.sessionId, 'finalVersions', versionId)),
          httpsCallable<unknown, ResultsPreview>(getFirebaseServices().functions, 'previewFinalResults')({ eventId: session.eventId, sessionId: session.sessionId }),
        ]).then(([version, result]) => {
          if (!valid || attempt !== generation || !version.exists()) return;
          const value = version.data() as SavedVersion;
          setSaved(value); setChanged(value.sourceFingerprint !== result.data.sourceFingerprint);
        }).catch(() => { if (valid && attempt === generation) setChanged(null); });
      }, 80);
    };
    // Private reads detect changed inputs without replacing the confirmed version.
    const unsubs = ['scores', 'registrations'].map(name => onSnapshot(collection(db, 'events', session.eventId!, name), check, () => { if (valid) setChanged(null); }));
    check();
    return () => { valid = false; generation++; clearTimeout(timer); unsubs.forEach(unsub => unsub()); };
  }, [session.eventId, session.sessionId, state?.versionId, ended]);

  async function loadPreview() {
    if (busy.current) return;
    busy.current = true; setPending(true); setError(''); setRetry(null); setReplaceConsent(false);
    try {
      const result = await httpsCallable<unknown, ResultsPreview>(getFirebaseServices().functions, 'previewFinalResults')({ eventId: session.eventId, sessionId: session.sessionId });
      if (active.current) { setPreview(result.data); setPreviewPage(0); }
    } catch { if (active.current) { setPreview(null); setError('Konečný náhled nelze načíst. Zkontrolujte akci a spojení.'); } }
    finally { busy.current = false; if (active.current) setPending(false); }
  }
  function stopSound() { epoch.current++; sound.current?.stop(); }
  async function playConfirmed(response: FinalResponse, key: string, commandEpoch: number) {
    const allowed = () => active.current && commandEpoch === epoch.current && !endRef.current && current.current.status === 'active'
      && current.current.revision <= response.revision;
    if (!allowed()) return;
    try {
      // A shared listener can lag the callable response, even with getDocFromServer.
      // A read-only transaction verifies the current server document without changing it.
      const db = getFirebaseFirestore();
      const fresh = await runTransaction(db, transaction => transaction.get(doc(db, 'sessions', session.sessionId)));
      const value = fresh.exists() ? mapLiveControlState(fresh.id, fresh.data()) : undefined;
      if (!allowed() || value?.revision !== response.revision || value.status !== 'active'
        || value.finalReveal?.versionId !== response.versionId || !value.finalReveal?.visible
        || value.finalReveal.revealedCount !== value.finalReveal.totalGroups) return;
      void sound.current?.play(key, allowed);
    } catch { if (allowed()) setError('Aktuální stav zvuku nelze ověřit. Po obnovení spojení použijte ruční přehrání.'); }
  }
  async function control(action: Action, page?: number, repeated?: Record<string, unknown>) {
    if (busy.current) return;
    if (action === 'hide' || action === 'replace') stopSound();
    if (action === 'reveal' && !repeated) sound.current?.prepare(); // User gesture, before network; no notes yet.
    const commandEpoch = epoch.current;
    const confirming = action === 'start' || action === 'replace';
    const request = repeated ?? { eventId: session.eventId, sessionId: session.sessionId, action, requestId: crypto.randomUUID(),
      versionId: confirming ? preview!.publishedVersionId : state?.versionId ?? null,
      expectedRevision: confirming ? preview!.sessionRevision : session.revision,
      ...(confirming ? { sourceFingerprint: preview!.sourceFingerprint } : action === 'page' ? { page } : {}) };
    busy.current = true; setPending(true); setError(''); setRetry(null);
    try {
      const { data } = await httpsCallable<unknown, FinalResponse>(getFirebaseServices().functions, 'controlFinalReveal')(request);
      if (!active.current) return;
      if (confirming) setPreview(null);
      if (data.winnerRevealed && !data.replayed && !repeated) void playConfirmed(data, String(request.requestId), commandEpoch);
    } catch (e) {
      if (!active.current) return;
      const code = (e as { code?: string }).code;
      if (code === 'functions/aborted') { setPreview(null); setError('Náhled, verze nebo prezentace se změnily. Načtěte nový náhled a zkontrolujte stav.'); }
      else if (code === 'functions/failed-precondition' || code === 'functions/permission-denied') setError('Příkaz není v aktuálním stavu nebo s tímto oprávněním dostupný.');
      else { setRetry(request); setError('Příkaz nelze potvrdit. Zkontrolujte projektor; stejný požadavek lze bezpečně zopakovat bez fanfáry.'); }
    } finally { busy.current = false; if (active.current) setPending(false); }
  }
  function manualSound() {
    stopSound();
    sound.current?.prepare();
    void playConfirmed({ sessionId: session.sessionId, versionId: state!.versionId, revision: session.revision, winnerRevealed: false, replayed: false }, crypto.randomUUID(), epoch.current);
  }
  const confirmedRows = saved?.versionId === state?.versionId ? saved?.rows ?? [] : [];
  const groupRows = state?.mode === 'group' ? confirmedRows.filter(r => r.rank === state.rank) : confirmedRows;
  const visiblePage: FinalRevealPage | null = state && (state.mode === 'intro' || confirmedRows.length > 0) ? {
    versionId: state.versionId, mode: state.mode, rank: state.rank, page: state.page, pageCount: state.pageCount,
    groupSize: state.mode === 'group' ? groupRows.length : 0, rows: state.mode === 'intro' ? [] : groupRows.slice(state.page * 8, (state.page + 1) * 8),
  } : null;
  return <section className="interim-panel final-panel" aria-label="Ovládání finálního vyhlášení" aria-busy={pending}>
    <h2>Finální vyhlášení</h2><p>Všechna kola včetně posledního. Vyhlášení i jeho ukončení řídíte ručně.</p>
    <p className="version-state">{state ? `Potvrzená verze ${state.versionId.slice(0, 12)} · ${state.visible && !ended ? 'na projektoru' : 'skrytá'} · odhaleno ${state.revealedCount}/${state.totalGroups} umístění` : 'Finále ještě nebylo potvrzeno.'}</p>
    {ended ? <p>Session je ukončená. Finále nelze obnovit.</p> : <>
      <p>Po posledním kole či recapu otevřete konečný náhled před tlačítkem Ukončit kvíz.</p>
      {state && (changed === true ? <p role="alert">Podklady se změnily. Vyhlašujete stále potvrzenou verzi. Pro opravu načtěte nový náhled a výslovně nahraďte finále.</p> : changed === null ? <p>Shodu podkladů se právě nedaří potvrdit. Uložená verze se nemění.</p> : <p>Podklady odpovídají potvrzené verzi.</p>)}
      <button className="secondary-button" disabled={pending || ending} onClick={() => void loadPreview()}>Načíst konečný náhled</button>
      {preview && <section aria-label="Soukromý konečný náhled"><h3>Konečný náhled — zatím nepotvrzeno</h3><p>Zahrnutá kola: {preview.includedRounds.map(r => r.title).join(', ')}</p>
        {!preview.complete ? <><p role="alert">Zahájení je zablokované: {preview.rows.length === 0 ? 'žádné přijaté týmy.' : 'chybějí body.'}</p><ul>{preview.missing.map(m => <li key={m.teamId + ':' + m.roundId}>{m.teamName} — {m.roundTitle}: nezadáno</li>)}</ul></> : <><div className="results-frame"><ResultsTable final page={previewPage} pageCount={Math.ceil(preview.rows.length / 8)} rows={preview.rows.slice(previewPage * 8, (previewPage + 1) * 8)} /></div><div className="interim-actions"><button className="secondary-button" disabled={previewPage === 0} onClick={() => setPreviewPage(p => p - 1)}>Předchozí stránka konečného náhledu</button><button className="secondary-button" disabled={(previewPage + 1) * 8 >= preview.rows.length} onClick={() => setPreviewPage(p => p + 1)}>Další stránka konečného náhledu</button></div></>}
        {state && <label><input type="checkbox" checked={replaceConsent} onChange={e => setReplaceConsent(e.target.checked)} /> Potvrzuji nahrazení: nová verze začne vyhlášení znovu. Historie zůstane zachovaná.</label>}
        <div className="interim-actions"><button className="primary-button" disabled={!preview.complete || pending || ending || session.status !== 'active' || (!!state && !replaceConsent)} onClick={() => void control(state ? 'replace' : 'start')}>{state ? 'Nahradit finále a začít znovu' : 'Zahájit vyhlášení'}</button></div>
        {session.status === 'waiting' && <p>Nejprve spusťte prezentaci tlačítkem Další.</p>}
      </section>}
      {state && <>
        {visiblePage && <section aria-label="Náhled potvrzeného finále"><div className="results-frame"><FinalRevealView {...visiblePage} /></div></section>}
        <div className="interim-actions">{state.visible ? <>
          <button className="primary-button" disabled={pending || ending || state.revealedCount === state.totalGroups} onClick={() => void control('reveal')}>Odhalit další umístění</button>
          <button className="secondary-button" disabled={pending || ending || state.page === 0} onClick={() => void control('page', state.page - 1)}>Předchozí stránka finále</button>
          <button className="secondary-button" disabled={pending || ending || state.page + 1 >= state.pageCount} onClick={() => void control('page', state.page + 1)}>Další stránka finále</button>
          <button className="secondary-button" disabled={pending || ending || state.revealedCount !== state.totalGroups || state.mode === 'table'} onClick={() => void control('table')}>Zobrazit celé konečné pořadí</button>
          <button className="secondary-button" disabled={pending || ending} onClick={() => void control('hide')}>Skrýt finále</button>
        </> : <button className="primary-button" disabled={pending || ending} onClick={() => void control('resume')}>Pokračovat ve stejné verzi</button>}</div>
        <p>Další stránka nemění odhalené umístění. Skrytí zachová verzi i postup.</p>
      </>}
    </>}
    <div className="sound-controls" aria-label="Vítězná fanfára">
      <button className="danger-button" onClick={stopSound}>STOP fanfáry</button>
      <button className="secondary-button" disabled={ended || ending || pending || !state?.visible || state.revealedCount !== state.totalGroups} onClick={manualSound}>Přehrát fanfáru ručně</button>
      <label>Hlasitost fanfáry<input type="range" min="0" max="0.3" step="0.01" value={volume} onChange={e => setVolume(Number(e.target.value))} /></label>
      <label><input type="checkbox" checked={muted} onChange={e => setMuted(e.target.checked)} /> Ztlumit fanfáru</label>
      <span role="status">{soundStatus === 'playing' ? 'Fanfára se přehrává v tomto panelu.' : soundStatus === 'blocked' ? 'Prohlížeč zvuk nepovolil. Zkuste tlačítko Přehrát fanfáru ručně.' : 'Fanfára nehraje.'}</span>
    </div>
    {error && <p role="alert">{error}</p>}
    {retry && !ended && <button className="secondary-button" disabled={pending || ending} onClick={() => void control(retry.action as Action, undefined, retry)}>Zopakovat nepotvrzený příkaz</button>}
  </section>;
}
