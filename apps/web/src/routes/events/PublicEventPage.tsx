import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { createEventRegistration, registrationActionError, type RegistrationFormValues } from '../../features/events/registrationApi';
import { getPublicEvent } from '../../features/events/eventRepository';
import type { PublicEventRecord, RegistrationMutationResponse } from '../../features/events/types';
import { RegistrationForm } from '../../features/registrations/RegistrationForm';

const EMPTY: RegistrationFormValues = { teamName: '', memberCount: 2, contactEmail: '' };

export function PublicEventPage() {
  const { eventId } = useParams<{ eventId: string }>();
  const [event, setEvent] = useState<PublicEventRecord | null>(null);
  const [values, setValues] = useState(EMPTY);
  const [created, setCreated] = useState<RegistrationMutationResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!eventId) return;
    setLoading(true);
    try {
      const nextEvent = await getPublicEvent(eventId);
      setEvent(nextEvent);
      if (nextEvent) setValues((current) => ({ ...current, memberCount: nextEvent.teamSizeMin }));
    } catch { setError('Akci se nepodařilo načíst.'); }
    finally { setLoading(false); }
  }, [eventId]);
  useEffect(() => { void load(); }, [load]);

  if (loading) return <section className="event-public-state">Načítám akci…</section>;
  if (!event) return <section className="event-public-state"><h1>Akce není dostupná</h1><Link to="/events">Zpět na akce</Link></section>;
  const now = Date.now();
  const open = event.registrationPublished
    && event.registrationStatus !== 'full'
    && event.registrationOpensAt !== undefined
    && event.registrationClosesAt !== undefined
    && now >= event.registrationOpensAt.getTime()
    && now < event.registrationClosesAt.getTime();
  const managementPath = created?.managementToken
    ? `/events/${event.id}/registration/manage#registration=${encodeURIComponent(created.registrationId)}&token=${encodeURIComponent(created.managementToken)}`
    : '';
  const submit = async () => {
    setPending(true); setError(null);
    try { setCreated(await createEventRegistration(event.id, values)); }
    catch (reason) { setError(registrationActionError(reason)); }
    finally { setPending(false); }
  };
  return <article className="public-event-detail">
    <Link className="back-link" to="/events">← Zpět na akce</Link>
    <header><p className="eyebrow">Veřejná registrace</p><h1>{event.title}</h1><p className="lead">{event.venueName} · {new Intl.DateTimeFormat('cs-CZ', { dateStyle: 'full', timeStyle: 'short', timeZone: event.timeZone }).format(event.startsAt)}</p><p>{event.publicLocation}</p></header>
    <section className="event-section registration-summary"><h2>{open ? 'Registrace je otevřená' : event.registrationStatus === 'full' ? 'Kapacita je naplněna' : 'Registrace není otevřená'}</h2><p>Týmy: {event.acceptedTeams} / {event.teamCapacity} · Lidé: {event.acceptedPeople} / {event.peopleCapacity}</p><p>Velikost týmu: {event.teamSizeMin}–{event.teamSizeMax} členů.</p></section>
    {created ? <section className="event-section registration-success" role="status"><h2>Děkujeme, tým byl přihlášen.</h2><p><strong>{created.teamName}</strong> · {created.memberCount} lidí · {event.title}</p><p>Tento odkaz si uschovejte. Umožňuje registraci upravit nebo zrušit.</p><Link className="primary-button" to={managementPath}>Spravovat registraci</Link></section>
      : open ? <section className="event-section"><h2>Přihlásit tým</h2>{error && <p className="round-editor-error" role="alert">{error}</p>}<RegistrationForm values={{ ...values, memberCount: values.memberCount || event.teamSizeMin }} minimum={event.teamSizeMin} maximum={event.teamSizeMax} pending={pending} submitLabel="Přihlásit tým" onChange={setValues} onSubmit={() => void submit()} /></section>
        : <p className="event-public-state">Novou registraci teď nelze vytvořit.</p>}
  </article>;
}
