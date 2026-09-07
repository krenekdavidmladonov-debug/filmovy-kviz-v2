import { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';

import { cancelManagedRegistration, getManagedRegistration, registrationActionError, updateManagedRegistration, type RegistrationFormValues } from '../../features/events/registrationApi';
import type { RegistrationMutationResponse } from '../../features/events/types';
import { RegistrationForm } from '../../features/registrations/RegistrationForm';

export function ManageRegistrationPage() {
  const { eventId } = useParams<{ eventId: string }>();
  const location = useLocation();
  const search = new URLSearchParams(location.hash.replace(/^#/u, ''));
  const registrationId = search.get('registration') ?? '';
  const token = search.get('token') ?? '';
  const [registration, setRegistration] = useState<RegistrationMutationResponse | null>(null);
  const [values, setValues] = useState<RegistrationFormValues>({ teamName: '', memberCount: 1, contactEmail: '' });
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!eventId || !registrationId || !token) { setError('Bezpečný odkaz není platný.'); return; }
    void getManagedRegistration(eventId, registrationId, token).then((result) => {
      setRegistration(result); setValues({ teamName: result.teamName, memberCount: result.memberCount, contactEmail: result.contactEmail });
    }).catch((reason) => setError(registrationActionError(reason)));
  }, [eventId, registrationId, token]);
  const save = async () => {
    if (!eventId) return; setPending(true); setError(null); setMessage(null);
    try { const result = await updateManagedRegistration(eventId, registrationId, token, values); setRegistration(result); setMessage('Registrace byla upravena.'); }
    catch (reason) { setError(registrationActionError(reason)); } finally { setPending(false); }
  };
  const cancel = async () => {
    if (!eventId || !window.confirm('Opravdu zrušit registraci týmu?')) return; setPending(true); setError(null);
    try { const result = await cancelManagedRegistration(eventId, registrationId, token); setRegistration(result); setMessage('Registrace byla zrušena.'); }
    catch (reason) { setError(registrationActionError(reason)); } finally { setPending(false); }
  };
  return <article className="public-event-detail"><Link className="back-link" to={eventId ? `/events/${eventId}` : '/events'}>← Zpět na akci</Link><header><p className="eyebrow">Bezpečný management link</p><h1>Správa registrace</h1></header>
    {error && <p className="round-editor-error" role="alert">{error}</p>}{message && <p className="event-notice" role="status">{message}</p>}
    {!registration && !error && <p>Ověřuji odkaz…</p>}
    {registration?.status === 'cancelled' ? <section className="event-section"><h2>Registrace je zrušená</h2><p>{registration.teamName}</p></section> : registration ? <section className="event-section"><h2>{registration.teamName}</h2><RegistrationForm values={values} minimum={1} maximum={1000} pending={pending} submitLabel="Uložit změny" onChange={setValues} onSubmit={() => void save()} /><button className="danger-button" type="button" disabled={pending} onClick={() => void cancel()}>Zrušit registraci</button></section> : null}
  </article>;
}
