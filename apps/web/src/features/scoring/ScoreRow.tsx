import { useEffect, useRef, useState } from 'react';
import { loadHistory, saveScore, type ScoreRequest } from './api';
import { pointsText, parsePoints, scoreLabel, type Score, type ScoreHistory } from './model';

interface Props {
  eventId: string; snapshotId: string; teamId: string; roundId: string; name: string;
  stored: Score; disabled: boolean; onDirty: (id: string, dirty: boolean) => void;
}
export function ScoreRow({ eventId, snapshotId, teamId, roundId, name, stored, disabled, onDirty }: Props) {
  const [draft, setDraft] = useState<{ text: string; reason: string; base: Score } | null>(null);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const retry = useRef<ScoreRequest | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [conflict, setConflict] = useState<Score | null>(null);
  const [history, setHistory] = useState<ScoreHistory[] | null>(null);
  const dirty = draft !== null;
  useEffect(() => { onDirty(teamId, dirty || pending); }, [teamId, dirty, pending, onDirty]);
  const current = conflict && conflict.revision > stored.revision ? conflict : stored;
  const stale = draft !== null && draft.base.revision !== current.revision;
  const change = (field: 'text' | 'reason', value: string) => {
    retry.current = null; setNotice(''); setError('');
    setDraft(previous => ({ ...(previous ?? { text: pointsText(current.halfPoints), reason: '', base: current }), [field]: value }));
  };
  async function save(clear = false) {
    if (busy.current || disabled || (stale && retry.current === null)) return;
    let halfPoints: number | null;
    const base = draft?.base ?? current;
    const reason = draft?.reason.trim() ?? '';
    try {
      halfPoints = clear ? null : parsePoints(draft?.text ?? pointsText(current.halfPoints));
      if ((base.halfPoints !== null || clear) && !reason) throw new Error('Doplňte stručný důvod opravy nebo vrácení na nezadáno.');
      if (base.halfPoints === halfPoints) throw new Error('Hodnota se nezměnila.');
    } catch (issue) { setError((issue as Error).message); return; }
    if (clear && !window.confirm('Vrátit výsledek týmu ' + name + ' na nezadáno? Historie zůstane zachována.')) return;
    const content = { eventId, snapshotId, teamId, roundId, expectedRevision: base.revision, halfPoints, reason };
    const previous = retry.current;
    const request = previous && Object.entries(content).every(([key, value]) => previous[key as keyof ScoreRequest] === value)
      ? previous : { ...content, requestId: crypto.randomUUID() };
    retry.current = request;
    busy.current = true; setPending(true); setError(''); setNotice('');
    try {
      const confirmed = await saveScore(request);
      retry.current = null; setDraft(null); setConflict(confirmed); setHistory(null);
      setNotice('Uložení potvrzeno serverem.');
    } catch (issue) {
      const failure = issue as { code?: string; details?: Score };
      if (failure.code === 'functions/aborted') {
        retry.current = null;
        if (failure.details && Number.isSafeInteger(failure.details.revision)) setConflict(failure.details);
        setError('Konflikt: mezitím byl uložen jiný zápis. Váš vstup zůstává zachován.');
      } else setError('Uložení se nepodařilo potvrdit. Vstup zůstal zachován; stejný požadavek můžete zopakovat.');
    } finally { busy.current = false; setPending(false); }
  }
  return <section className="score-row" aria-label={name}>
    <div className="event-section-heading"><h3>{name}</h3><span>{scoreLabel(current.halfPoints)} · revize {current.revision}</span></div>
    <form onSubmit={event => { event.preventDefault(); void save(); }}>
      <div className="score-fields">
        <label className="form-field"><span>Body — {name}</span><input inputMode="decimal" value={draft?.text ?? pointsText(current.halfPoints)} disabled={disabled || pending} onChange={event => change('text', event.target.value)} /></label>
        {(current.halfPoints !== null || draft?.base.halfPoints != null) && <label className="form-field"><span>Důvod opravy — {name}</span><input maxLength={300} value={draft?.reason ?? ''} disabled={disabled || pending} onChange={event => change('reason', event.target.value)} /></label>}
      </div>
      <p className="event-muted">{pending ? 'Čekám na potvrzení serveru…' : dirty ? 'Změněno · neuloženo' : current.halfPoints === null ? 'Výsledek není zadán.' : 'Uložený výsledek'}</p>
      {stale && <div className="score-conflict" role="alert"><p>Aktuálně uloženo: {scoreLabel(current.halfPoints)}. Rozepsaná hodnota: {draft?.text || '(prázdná)'}. Zápis vyžaduje vaše rozhodnutí.</p><button type="button" className="secondary-button" disabled={pending || disabled} onClick={() => { retry.current = null; setDraft(previous => previous && ({ ...previous, base: current })); setError(''); }}>Připravit opravu aktuální revize</button></div>}
      <div className="team-tool-actions">
        <button className="primary-button" type="submit" disabled={!dirty || pending || disabled || (stale && retry.current === null)}>Uložit</button>
        {current.halfPoints !== null && <button className="secondary-button" type="button" disabled={pending || disabled || stale} onClick={() => void save(true)}>Vrátit na nezadáno</button>}
        {dirty && <button type="button" className="secondary-button" disabled={pending} onClick={() => { if (window.confirm('Zahodit rozepsané změny tohoto týmu?')) { setDraft(null); retry.current = null; setError(''); } }}>Zahodit změny</button>}
        <button type="button" className="secondary-button" onClick={() => { if (history) setHistory(null); else void loadHistory(eventId, teamId, roundId).then(setHistory).catch(() => setError('Historii se nepodařilo načíst.')); }}>Historie změn</button>
      </div>
    </form>
    {error && <p role="alert" className="round-editor-error">{error}</p>}
    {notice && <p role="status" className="event-notice">{notice}</p>}
    {history && <div className="score-history">{history.length === 0 ? <p>Žádné zápisy.</p> : <ol>{history.map(item => <li key={item.revision}><strong>{scoreLabel(item.previousHalfPoints)} → {scoreLabel(item.halfPoints)}</strong><span>{item.createdAt} · uživatel {item.actorUid} · revize {item.revision}</span>{item.reason && <p>{item.reason}</p>}</li>)}</ol>}</div>}
  </section>;
}
