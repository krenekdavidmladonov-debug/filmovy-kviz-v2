import { useCallback, useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';

import { useAuth } from '../../auth/AuthProvider';
import { ManualTeamDialog } from '../../features/events/ManualTeamDialog';
import { RegistrationSharePanel } from '../../features/events/RegistrationSharePanel';
import { adminCancelRegistration, configureEventRegistration, registrationActionError } from '../../features/events/registrationApi';
import { getEvent, listEventRegistrations } from '../../features/events/eventRepository';
import type { EventRecord, RegistrationRecord } from '../../features/events/types';
import { QuizErrorState } from '../../features/quizzes/QuizErrorState';
import { QuizLoading } from '../../features/quizzes/QuizLoading';

function localDateTime(value: Date): string {
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(value.getMinutes())}`;
}
export function AdminEventRegistrationsPage() {
  const { eventId } = useParams<{ eventId: string }>();
  const { role } = useAuth();
  const [event, setEvent] = useState<EventRecord | null>(null);
  const [registrations, setRegistrations] = useState<readonly RegistrationRecord[]>([]);
  const [opensAt, setOpensAt] = useState('');
  const [closesAt, setClosesAt] = useState('');
  const [published, setPublished] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [search] = useSearchParams();
  const [selectedId, setSelectedId] = useState(search.get('team') ?? '');
  const [teamDialog, setTeamDialog] = useState<RegistrationRecord | 'new' | null>(null);
  const load = useCallback(async () => {
    if (!eventId) return; setLoading(true);
    try {
      const [nextEvent, nextRegistrations] = await Promise.all([getEvent(eventId), listEventRegistrations(eventId)]);
      setEvent(nextEvent); setRegistrations(nextRegistrations);
      if (nextEvent) {
        setOpensAt(localDateTime(nextEvent.registrationOpensAt ?? new Date()));
        setClosesAt(localDateTime(nextEvent.registrationClosesAt ?? nextEvent.startsAt));
        setPublished(nextEvent.registrationPublished);
      }
    } catch { setError('Registrace se nepodařilo načíst.'); } finally { setLoading(false); }
  }, [eventId]);
  useEffect(() => { void load(); }, [load]);
  const configure = async () => {
    if (!event) return; setPending(true); setError(null); setNotice(null);
    try { await configureEventRegistration(event.id, event.revision, opensAt, closesAt, published); setNotice('Nastavení registrací bylo uloženo.'); await load(); }
    catch (reason) { setError(registrationActionError(reason)); } finally { setPending(false); }
  };
  const cancel = async (registration: RegistrationRecord) => {
    if (!event || !window.confirm(`Zrušit registraci týmu ${registration.teamName}?`)) return;
    setPending(true); setError(null);
    try { await adminCancelRegistration(event.id, registration.id); setNotice('Registrace byla administrativně zrušena.'); await load(); }
    catch (reason) { setError(registrationActionError(reason)); } finally { setPending(false); }
  };
  if (loading) return <QuizLoading label="Načítám registrace…" />;
  if (error && !event) return <QuizErrorState message={error} onRetry={() => void load()} />;
  if (!event) return <section className="quiz-state-card"><h2>Akce neexistuje</h2></section>;
  const admin = role === 'admin';
  return <article className="event-detail-page"><Link className="back-link" to={`/admin/events/${event.id}`}>← Zpět na akci</Link><header className="event-page-heading"><div><p className="eyebrow">Akce · Registrace</p><h1>{event.title}</h1><p className="lead">{event.acceptedTeams} / {event.teamCapacity} týmů · {event.acceptedPeople} / {event.peopleCapacity} osob</p></div><span className={`quiz-status status-${event.registrationStatus}`}>{event.registrationStatus}</span></header>
    {error && <p className="round-editor-error" role="alert">{error}</p>}{notice && <p className="event-notice" role="status">{notice}</p>}
    <RegistrationSharePanel event={event} />
    <section className="event-section"><div className="event-section-heading"><div><p className="eyebrow">Týmy</p><h2>Registrované týmy</h2></div>{admin && <button className="primary-button" type="button" onClick={() => setTeamDialog('new')}>+ Přidat tým</button>}</div>
      {registrations.length === 0 ? <p>Zatím bez registrací.</p> : <div className="registration-table-wrap"><table className="registration-table"><thead><tr><th>Tým</th><th>Členů</th><th>Stav / původ</th><th>E-mail</th><th>E-mailové potvrzení</th>{admin && <th>Akce</th>}</tr></thead><tbody>{registrations.map((item) => <tr key={item.id} className={item.id === selectedId ? 'team-selected' : ''} aria-selected={item.id === selectedId}><td>{item.teamName}</td><td>{item.memberCount}</td><td>{item.status === 'accepted' ? 'Přijatý' : 'Zrušený'}<br />{item.source === 'manual' ? 'Přidáno pořadatelem' : 'Online'}</td><td>{item.contactEmail ?? 'Neuveden'}</td><td>{item.emailDelivery ? <><span>{{ pending: 'Čeká na odeslání', sent: 'Odesláno', failed: 'Nepodařilo se' }[item.emailDelivery.status]}</span><br /><time dateTime={item.emailDelivery.updatedAt.toISOString()}>{item.emailDelivery.updatedAt.toLocaleString('cs-CZ')}</time></> : '—'}</td>{admin && <td>{item.status === 'accepted' && <div className="team-tool-actions">{item.source === 'manual' && <button className="secondary-button" type="button" disabled={pending} onClick={() => setTeamDialog(item)}>Upravit tým</button>}<button className="danger-button" type="button" disabled={pending} onClick={() => void cancel(item)}>Zrušit</button></div>}</td>}</tr>)}</tbody></table></div>}
    </section>
    {admin && teamDialog && <ManualTeamDialog event={event} {...(teamDialog === 'new' ? {} : { team: teamDialog })} onClose={() => setTeamDialog(null)} onSaved={async (id, name) => { setTeamDialog(null); setSelectedId(id); setNotice(`Tým ${name} byl uložen.`); await load(); }} />}
    <section className="event-section" id="registration-settings"><h2>Registrační okno</h2>{admin ? <form className="registration-form" onSubmit={(e) => { e.preventDefault(); void configure(); }}><label className="form-field"><span>Otevření</span><input required type="datetime-local" value={opensAt} onChange={(e) => setOpensAt(e.target.value)} /></label><label className="form-field"><span>Uzavření</span><input required type="datetime-local" value={closesAt} onChange={(e) => setClosesAt(e.target.value)} /></label><label className="warning-confirmation"><input type="checkbox" checked={published} onChange={(e) => setPublished(e.target.checked)} /> Zveřejnit registraci</label><button className="primary-button" disabled={pending}>Uložit nastavení</button></form> : <p>Moderátor má přístup pouze pro čtení.</p>}</section>
  </article>;
}
