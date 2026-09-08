import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useBlocker, useParams } from 'react-router-dom';
import { ScoreRow } from '../../features/scoring/ScoreRow';
import { emptyScore } from '../../features/scoring/model';
import { consumeRefereeCredential, forgetReferee } from '../../features/referee/sharing';
import { readReferee, writeReferee, historyReferee, type RefereeEvent } from '../../features/referee/api';
import '../../features/scoring/scoring.css';

export function RefereePage() {
  const { eventId = '' } = useParams();
  const [credential] = useState(() => consumeRefereeCredential(eventId));
  const previousView = useRef<RefereeEvent | null>(null);
  const [data, setData] = useState<RefereeEvent | null>(null), [round, setRound] = useState(''), [blocked, setBlocked] = useState(!credential), [error, setError] = useState('');
  const [dirty, setDirty] = useState<Record<string, boolean>>({});
  const hasDirty = Object.values(dirty).some(Boolean), blocker = useBlocker(hasDirty);
  const markDirty = useCallback((id: string, value: boolean) => setDirty(old => old[id] === value ? old : { ...old, [id]: value }), []);
  const failure = useCallback((issue: unknown) => { const code = (issue as { code?: string }).code;
    if (code === 'functions/permission-denied') { forgetReferee(eventId); setBlocked(true); setError('Přístup vypršel / byl odebrán'); }
    else setError('Aktuální data nelze ověřit. Uložené jsou jen serverem potvrzené zápisy.');
  }, [eventId]);
  useEffect(() => {
    if (!credential || blocked) return;
    let active = true, busy = false;
    const poll = async () => { if (busy) return; busy = true; try { const next = await readReferee(credential); if (active) { const previous = previousView.current; if (previous && (previous.snapshotId !== next.snapshotId || previous.teams.some(team => !next.teams.some(current => current.id === team.id)))) { setError('Připravený kvíz nebo soupiska se změnily. Před obnovením stránky zkontrolujte rozepsané body.'); return; } previousView.current = next; setData(next); setRound(old => old || next.rounds[0]?.id || ''); setError(''); } } catch (issue) { if (active) failure(issue); } finally { busy = false; } };
    void poll(); const timer = window.setInterval(() => void poll(), 5000);
    return () => { active = false; clearInterval(timer); };
  }, [credential, blocked, failure]);
  useEffect(() => { if (!hasDirty) return; const guard = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; }; window.addEventListener('beforeunload', guard); return () => window.removeEventListener('beforeunload', guard); }, [hasDirty]);
  useEffect(() => { if (blocker.state === 'blocked') { if (window.confirm('Máte neuložené body. Odejít a zahodit změny?')) blocker.proceed(); else blocker.reset(); } }, [blocker]);
  const transport = useMemo(() => ({ save: async (request: Parameters<typeof writeReferee>[1]) => { try { return await writeReferee(credential!, request); } catch (issue) { if ((issue as { code?: string }).code !== 'functions/aborted') failure(issue); throw issue; } }, history: async (_event: string, team: string, roundId: string) => { try { return await historyReferee(credential!, team, roundId); } catch (issue) { failure(issue); throw issue; } } }), [credential, failure]);
  return <main className="event-detail-page" style={{ maxWidth: 1100, margin: 'auto', padding: 20 }}><header><p className="eyebrow">Soukromý přístup rozhodčího</p><h1>Bodování</h1><p>{data?.title} · {data?.label}</p></header>
    {(blocked || !credential) && <p role="alert">Přístup vypršel / byl odebrán</p>}{error && !blocked && <p role="alert">{error}</p>}
    {!data && !blocked && credential && !error && <p>Ověřuji přístup…</p>}
    {data && <section className="event-section"><label className="form-field"><span>Kolo připraveného kvízu</span><select disabled={blocked || !!error} value={round} onChange={e => { if (hasDirty && !window.confirm('Změnit kolo a zahodit neuložené body?')) return; setDirty({}); setRound(e.target.value); }}>{data.rounds.map(r => <option key={r.id} value={r.id}>{r.title}</option>)}</select></label><p>Půlbody, například 0; 2,5 nebo 2.5. Každý tým ukládejte samostatně.</p>
      {data.teams.map(team => <ScoreRow key={JSON.stringify([data.snapshotId, round, team.id])} eventId={eventId} snapshotId={data.snapshotId} roundId={round} teamId={team.id} name={team.name} stored={data.scores.find(s => s.teamId === team.id && s.roundId === round) ?? emptyScore} disabled={blocked || !!error} onDirty={markDirty} transport={transport} />)}
    </section>}
    <button type="button" className="secondary-button" onClick={() => { if (hasDirty && !window.confirm('Ukončit přístup a zahodit rozepsané změny?')) return; forgetReferee(eventId); setBlocked(true); setData(null); }}>Ukončit přístup v tomto panelu</button>
  </main>;
}
