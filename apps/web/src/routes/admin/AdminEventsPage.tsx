import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { useAuth } from '../../auth/AuthProvider';
import { listEvents } from '../../features/events/eventRepository';
import type { EventRecord } from '../../features/events/types';
import { QuizErrorState } from '../../features/quizzes/QuizErrorState';
import { QuizLoading } from '../../features/quizzes/QuizLoading';

const lifecycleLabels: Record<EventRecord['lifecycleStatus'], string> = {
  draft: 'Koncept', scheduled: 'Naplánováno', ready: 'Připraveno', live: 'Probíhá',
  finalizing: 'Uzavírání', completed: 'Dokončeno', cancelled: 'Zrušeno', archived: 'Archivováno',
};

function formatDate(value: Date): string {
  return new Intl.DateTimeFormat('cs-CZ', { dateStyle: 'medium', timeStyle: 'short' }).format(value);
}

export function AdminEventsPage() {
  const { role } = useAuth();
  const [events, setEvents] = useState<readonly EventRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try { setEvents(await listEvents()); }
    catch { setError('Akce se nepodařilo načíst.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  if (loading) return <QuizLoading label="Načítám akce…" />;
  if (error) return <QuizErrorState message={error} onRetry={() => void load()} />;
  return (
    <section className="event-library">
      <header className="section-heading">
        <div><p className="eyebrow">Administrace</p><h1>Akce</h1><p className="lead">Termíny, kapacity a připravené verze kvízů.</p></div>
        {role === 'admin' && <Link className="primary-button" to="/admin/events/new">Vytvořit akci</Link>}
      </header>
      {events.length === 0 ? (
        <div className="quiz-state-card"><div><h2>Zatím tu nejsou žádné akce</h2><p>Vytvořte první termín a připravte pro něj kvíz.</p></div></div>
      ) : (
        <div className="event-card-list">
          {events.map((event) => (
            <Link className="event-card" key={event.id} to={`/admin/events/${event.id}`}>
              <div><span className={`quiz-status status-${event.lifecycleStatus}`}>{lifecycleLabels[event.lifecycleStatus]}</span><h2>{event.title}</h2><p>{event.venue.name}</p></div>
              <div className="event-card-meta"><strong>{formatDate(event.startsAt)}</strong><span>{event.quizAssignment ? 'Kvíz připraven' : 'Kvíz nepřiřazen'}</span></div>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
