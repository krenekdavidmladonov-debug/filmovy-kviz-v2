import { useCallback, useEffect, useState } from 'react';
import { Link, useBlocker, useParams } from 'react-router-dom';
import { loadRounds, watchRoster, watchScores, watchScoringEvent } from '../../features/scoring/api';
import { emptyScore, type Score } from '../../features/scoring/model';
import { ScoreRow } from '../../features/scoring/ScoreRow';
import { useAuth } from '../../auth/AuthProvider';
import '../../features/scoring/scoring.css';

export function AdminEventScoringPage() {
  const { can } = useAuth();
  const { eventId = '' } = useParams();
  const [snapshotId, setSnapshotId] = useState<string | null>(null);
  const [liveSnapshotId, setLiveSnapshotId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [allowed, setAllowed] = useState(false);
  const [eventLoaded, setEventLoaded] = useState(false);
  const [rounds, setRounds] = useState<{ id: string; title: string }[]>([]);
  const [roundId, setRoundId] = useState('');
  const [teams, setTeams] = useState<{ id: string; name: string; accepted: boolean }[]>([]);
  const [scores, setScores] = useState<Record<string, Score>>({});
  const [scoresLoaded, setScoresLoaded] = useState(false);
  const [dirty, setDirty] = useState<Record<string, boolean>>({});
  const [error, setError] = useState('');
  const hasDirty = Object.values(dirty).some(Boolean);
  const blocker = useBlocker(hasDirty);
  const onDirty = useCallback((id: string, value: boolean) => setDirty(previous => previous[id] === value ? previous : { ...previous, [id]: value }), []);
  useEffect(() => {
    if (blocker.state === 'blocked') {
      if (window.confirm('Máte neuložené body. Opravdu odejít a zahodit změny?')) blocker.proceed();
      else blocker.reset();
    }
  }, [blocker]);
  useEffect(() => {
    if (!hasDirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [hasDirty]);
  useEffect(() => {
    const fail = () => setError('Aktuální data se nepodařilo načíst. Obnovte stránku; rozepsané body si nejprve zkontrolujte.');
    const stopEvent = watchScoringEvent(eventId, (id, canWrite, eventTitle = '') => {
      setTitle(eventTitle);
      setSnapshotId(previous => previous ?? id); setLiveSnapshotId(id); setAllowed(canWrite); setEventLoaded(true);
    }, fail);
    const stopTeams = watchRoster(eventId, setTeams, fail);
    const stopScores = watchScores(eventId, data => { setScores(data); setScoresLoaded(true); }, fail);
    return () => { stopEvent(); stopTeams(); stopScores(); };
  }, [eventId]);
  useEffect(() => {
    if (!snapshotId) return;
    let active = true;
    void loadRounds(snapshotId).then(data => { if (active) { setRounds(data); setRoundId(data[0]?.id ?? ''); } })
      .catch(() => { if (active) setError('Kola snapshotu se nepodařilo načíst.'); });
    return () => { active = false; };
  }, [snapshotId]);
  const snapshotChanged = snapshotId !== liveSnapshotId;
  return <article className="event-detail-page">
    <Link className="back-link" to={'/admin/events/' + eventId}>← Zpět na detail akce</Link>
    <header className="event-page-heading"><div><p className="eyebrow">Interní zápis</p><h1>Bodování</h1><p className="event-muted">{title}</p><p className="lead">Součet bodů za celé kolo. Ukládejte každý tým samostatně.</p></div></header>
    {!eventLoaded && !error && <p>Načítám bodování akce…</p>}
    {error && <p role="alert" className="round-editor-error">{error}</p>}
    {eventLoaded && !allowed && <p role="status">V tomto stavu akce nelze zapisovat body.</p>}
    {snapshotChanged && <p role="alert">Připravený kvíz akce se změnil. Zkontrolujte rozepsané hodnoty a obnovte stránku.</p>}
    {eventLoaded && !snapshotId && <p>Nejprve připravte kvíz v detailu akce.</p>}
    {snapshotId && <section className="event-section">
      <label className="form-field"><span>Kolo připraveného kvízu</span><select value={roundId} onChange={event => {
        if (hasDirty && !window.confirm('Změnit kolo a zahodit neuložené body?')) return;
        setDirty({}); setRoundId(event.target.value);
      }}>{rounds.map(round => <option key={round.id} value={round.id}>{round.title}</option>)}</select></label>
      <p className="event-muted">Povoleny jsou půlbody, například 0; 2,5 nebo 2.5. Prázdné pole uložené body nemaže.</p>
      {!scoresLoaded ? <p>Načítám uložené body…</p> : roundId && teams.filter(team => team.accepted || dirty[team.id]).map(team => <ScoreRow
        key={JSON.stringify([eventId, snapshotId, roundId, team.id])} eventId={eventId} snapshotId={snapshotId}
        teamId={team.id} roundId={roundId} name={team.name + (team.accepted ? '' : ' (zrušený tým)')}
        stored={scores[JSON.stringify([team.id, roundId])] ?? emptyScore} disabled={!can('event.score') || !allowed || snapshotChanged || !team.accepted || !!error} onDirty={onDirty}
      />)}
      {scoresLoaded && roundId && teams.some(team => !team.accepted && !dirty[team.id]) && <details>
        <summary>Historické zápisy zrušených týmů</summary>
        {teams.filter(team => !team.accepted && !dirty[team.id]).map(team => <ScoreRow
          key={JSON.stringify([eventId, snapshotId, roundId, team.id])} eventId={eventId} snapshotId={snapshotId}
          teamId={team.id} roundId={roundId} name={team.name + ' (zrušený tým)'}
          stored={scores[JSON.stringify([team.id, roundId])] ?? emptyScore} disabled onDirty={onDirty}
        />)}
      </details>}
      {scoresLoaded && !teams.some(team => team.accepted) && <p>Akce zatím nemá přijaté týmy.</p>}
    </section>}
  </article>;
}
