import { useCallback, useEffect, useState } from 'react';

import { listPublicEvents } from '../../features/events/eventRepository';
import type { PublicEventRecord } from '../../features/events/types';

const registrationLabels: Record<PublicEventRecord['registrationStatus'], string> = {
  scheduled: 'Registrace bude oznámena',
  open: 'Registrace otevřená',
  paused: 'Registrace pozastavená',
  full: 'Kapacita naplněna',
  closed: 'Registrace uzavřená',
};

export function EventsPage() {
  const [events, setEvents] = useState<readonly PublicEventRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try { setEvents(await listPublicEvents()); }
    catch { setError(true); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  return (
    <section className="public-events-page">
      <header>
        <p className="eyebrow">Veřejná část</p>
        <h1>Nadcházející kvízy</h1>
        <p className="lead">Termíny a bezpečně zveřejněné informace o akcích.</p>
      </header>
      {loading ? <p className="event-public-state">Načítám akce…</p> : error ? (
        <div className="event-public-state"><p>Akce se nepodařilo načíst.</p><button className="secondary-button" type="button" onClick={() => void load()}>Načíst znovu</button></div>
      ) : events.length === 0 ? <p className="event-public-state">Žádné akce k zobrazení</p> : (
        <div className="public-event-grid">
          {events.map((event) => (
            <article className="public-event-card" key={event.id}>
              <span className="quiz-status">{registrationLabels[event.registrationStatus]}</span>
              <h2>{event.title}</h2>
              <p>{event.venueName}</p>
              <strong>{new Intl.DateTimeFormat('cs-CZ', { dateStyle: 'full', timeStyle: 'short', timeZone: event.timeZone }).format(event.startsAt)}</strong>
              <span>{event.publicLocation}</span>
              <small>Tým: {event.teamSizeMin}–{event.teamSizeMax} členů</small>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
