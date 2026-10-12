import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getHistoricalResults, type HistoricalResults } from '../../features/events/historicalResultsRepository';
import { QuizLoading } from '../../features/quizzes/QuizLoading';
import '../../features/events/historical-results.css';

type State = { eventId: string; result?: HistoricalResults; error?: 'denied' | 'network' };

export function AdminEventResultsPage() {
  const { eventId = '' } = useParams<{ eventId: string }>();
  const [state, setState] = useState<State>({ eventId });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setState({ eventId });
    void getHistoricalResults(eventId).then(result => {
      if (active) setState({ eventId, result });
    }).catch((error: unknown) => {
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
      if (active) setState({ eventId, error: /(?:permission-denied|unauthenticated)$/u.test(code) ? 'denied' : 'network' });
    });
    return () => { active = false; };
  }, [eventId, attempt]);
  const current = state.eventId === eventId ? state : { eventId };
  const result = current.result;
  return <article className="event-detail-page">
    <Link className="back-link" to={`/admin/events/${eventId}`}>← Zpět na detail akce</Link>
    <header className="event-page-heading"><div><p className="eyebrow">Historie akce</p><h1>Konečné výsledky</h1>
      {result && <p className="lead">{result.eventTitle}</p>}</div>
      {result?.status === 'available' && <span className="quiz-status status-completed">Dokončeno</span>}
    </header>
    {!result && !current.error && <QuizLoading label="Načítám konečné výsledky…" />}
    {current.error === 'denied' && <p role="alert">K výsledkům této akce nemáte přístup. Ověřte přihlášení a oprávnění.</p>}
    {current.error === 'network' && <section className="event-section"><p role="alert">Konečné výsledky se nepodařilo načíst. Zkontrolujte připojení a zkuste to znovu.</p><button className="secondary-button" onClick={() => setAttempt(value => value + 1)}>Zkusit znovu</button></section>}
    {result?.status === 'not-completed' && <p>Akce ještě není dokončená. Její průběh otevřete z detailu akce.</p>}
    {result?.status === 'unavailable' && <p>Konečné výsledky této akce nejsou k dispozici.</p>}
    {result?.status === 'available' && <section className="event-section historical-results" aria-label="Historické konečné pořadí">
      <p>Potvrzené konečné pořadí dokončené akce. Pouze pro čtení.</p>
      {result.completedAt && <p className="event-muted">Dokončeno {result.completedAt.toLocaleString('cs-CZ', { timeZone: 'Europe/Prague', dateStyle: 'medium', timeStyle: 'short' })} (Praha).</p>}
      <table><caption>Konečné pořadí</caption><thead><tr><th scope="col">Pořadí</th><th scope="col">Tým</th><th scope="col">Body</th></tr></thead>
        <tbody>{result.rows.map((row, index) => <tr key={index}><td>{row.rank}.</td><th scope="row">{row.teamName}</th><td>{(row.halfPoints / 2).toLocaleString('cs-CZ')}</td></tr>)}</tbody>
      </table>
      <p className="event-muted">Shodné body znamenají shodné umístění. Pozdější změny kvízu nebo týmů toto potvrzené pořadí nemění.</p>
    </section>}
  </article>;
}
