import { teamEmailEnabled } from '../../features/events/teamEmailCapability';
import { EventLiveButton } from '../../features/leaderboard/EventLiveButton';
import { RefereeAccessPanel } from '../../features/referee/RefereeAccessPanel';
import { runQuizPreflight, type EditorQuiz, type PreflightResult } from '@filmovy-kviz/quiz-domain';
import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { useAuth } from '../../auth/AuthProvider';
import {
  archiveEvent,
  cancelEvent,
  eventActionError,
  lockEventQuiz,
  updateEvent,
} from '../../features/events/eventApi';
import { EventForm } from '../../features/events/EventForm';
import { ManualTeamDialog } from '../../features/events/ManualTeamDialog';
import { RegistrationSharePanel } from '../../features/events/RegistrationSharePanel';
import { getEvent } from '../../features/events/eventRepository';
import type { EventFormValues, EventRecord } from '../../features/events/types';
import { getEditorQuiz } from '../../features/editor/editorRepository';
import { QuizErrorState } from '../../features/quizzes/QuizErrorState';
import { QuizLoading } from '../../features/quizzes/QuizLoading';
import { listQuizzes } from '../../features/quizzes/quizRepository';
import type { QuizSummary } from '../../features/quizzes/types';

const EventTeamMessagePanel = teamEmailEnabled
  ? lazy(() => import('../../features/events/EventTeamMessagePanel').then(module => ({ default: module.EventTeamMessagePanel })))
  : null;

function localDateTime(value: Date): string {
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(value.getMinutes())}`;
}

function formValues(event: EventRecord): EventFormValues {
  return {
    title: event.title,
    startsAt: localDateTime(event.startsAt),
    timeZone: event.timeZone,
    venueName: event.venue.name,
    publicLocation: event.venue.publicLocation,
    teamCapacity: event.teamCapacity,
    peopleCapacity: event.peopleCapacity,
    teamSizeMin: event.teamSizeMin,
    teamSizeMax: event.teamSizeMax,
  };
}

export function AdminEventDetailPage() {
  const { eventId } = useParams<{ eventId: string }>();
  const { can, currentUser } = useAuth();
  const canChooseQuiz = can('event.manage') && can('quiz.read') && can('quiz.export') && can('quiz.answers.read') && can('quiz.notes.read');
  const [event, setEvent] = useState<EventRecord | null>(null);
  const [values, setValues] = useState<EventFormValues | null>(null);
  const [quizzes, setQuizzes] = useState<readonly QuizSummary[]>([]);
  const [selectedQuizId, setSelectedQuizId] = useState('');
  const [selectedQuiz, setSelectedQuiz] = useState<EditorQuiz | null>(null);
  const [preflight, setPreflight] = useState<PreflightResult | null>(null);
  const [acknowledgeWarnings, setAcknowledgeWarnings] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [addingTeam, setAddingTeam] = useState(false);
  const [addedTeam, setAddedTeam] = useState<{ id: string; name: string } | null>(null);

  const load = useCallback(async () => {
    if (!eventId) return;
    setLoading(true);
    setError(null);
    try {
      const [loadedEvent, loadedQuizzes] = await Promise.all([getEvent(eventId), canChooseQuiz ? listQuizzes() : Promise.resolve([])]);
      setEvent(loadedEvent);
      setValues(loadedEvent ? formValues(loadedEvent) : null);
      setQuizzes(loadedQuizzes);
      if (loadedEvent?.quizAssignment) {
        setSelectedQuizId((current) => current === '' ? loadedEvent.quizAssignment?.quizId ?? '' : current);
      }
    } catch {
      setError('Detail akce se nepodařilo načíst.');
    } finally {
      setLoading(false);
    }
  }, [eventId, canChooseQuiz]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    let current = true;
    setAcknowledgeWarnings(false);
    setPreflight(null);
    setSelectedQuiz(null);
    if (!canChooseQuiz || selectedQuizId === '' || !quizzes.some(quiz => quiz.id === selectedQuizId)) return () => { current = false; };
    void getEditorQuiz(selectedQuizId).then((quiz) => {
      if (!current || quiz === null) return;
      setSelectedQuiz(quiz);
      setPreflight(runQuizPreflight(quiz));
    }).catch(() => { if (current) setError('Vybraný kvíz se nepodařilo načíst.'); });
    return () => { current = false; };
  }, [selectedQuizId, canChooseQuiz, quizzes]);

  const runAction = async (action: () => Promise<unknown>, success: string) => {
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      setNotice(success);
      await load();
    } catch (actionError) {
      setError(eventActionError(actionError));
    } finally {
      setPending(false);
    }
  };

  if (loading) return <QuizLoading label="Načítám detail akce…" />;
  if (error && event === null) return <QuizErrorState message={error} onRetry={() => void load()} />;
  if (!event || !values) return <section className="quiz-state-card"><div><h2>Akce neexistuje</h2><p>Požadovaný záznam nebyl nalezen.</p></div><Link className="secondary-link" to="/admin/events">Zpět na akce</Link></section>;

  const admin = can('event.manage');
  const locked = event.quizAssignment;
  const lockDisabled = pending || selectedQuiz === null || preflight === null
    || preflight.blockerCount > 0 || (preflight.warningCount > 0 && !acknowledgeWarnings);
  return (
    <article className="event-detail-page">
      <Link className="back-link" to="/admin/events">← Zpět na akce</Link>
      <header className="event-page-heading event-form-heading">
        <div><h1>{admin ? 'Upravit akci' : 'Detail akce'}</h1><p className="lead">{event.title} · {event.venue.name}</p></div>
        <span className={`quiz-status status-${event.lifecycleStatus}`}>{event.lifecycleStatus === 'ready' ? 'Připraveno' : event.lifecycleStatus}</span>
      </header>
      {error && <p className="round-editor-error" role="alert">{error}</p>}
      {notice && <p className="event-notice" role="status">{notice}</p>}

      {can('event.contacts') && <section className="event-section">
        <div className="event-section-heading"><div><p className="eyebrow">Registrace</p><h2>Týmy a kapacita</h2></div><span>{event.acceptedTeams} / {event.teamCapacity} týmů</span></div>
        <p className="event-muted">Registrační okno, souhrn osob a privátní kontakty týmů.</p>
        <div className="team-tool-actions">{admin && <button className="primary-button" type="button" onClick={() => setAddingTeam(true)}>+ Přidat tým</button>}<Link className="secondary-link" to={`/admin/events/${event.id}/registrations`}>Spravovat týmy a registrace</Link></div>
        {addedTeam && <p className="event-notice" role="status">Přidán tým: <Link to={`/admin/events/${event.id}/registrations?team=${addedTeam.id}`}>{addedTeam.name}</Link></p>}
      </section>}

      <section className="event-section">
        <div className="event-section-heading"><div><p className="eyebrow">Interní zápis</p><h2>Bodování</h2></div></div>
        <p className="event-muted">Body přijatých týmů za kola připraveného kvízu a historie oprav.</p>
        <Link className="secondary-link" to={`/admin/events/${event.id}/scoring`}>Otevřít bodování</Link>
      </section>
      {admin && can('event.contacts') && EventTeamMessagePanel && <Suspense fallback={null}><EventTeamMessagePanel key={event.id + ':' + currentUser?.uid} eventId={event.id} actorId={currentUser!.uid} canCreate={['draft', 'scheduled', 'ready', 'live'].includes(event.lifecycleStatus)} /></Suspense>}
      <RegistrationSharePanel event={event} />
      {admin && addingTeam && <ManualTeamDialog event={event} onClose={() => setAddingTeam(false)} onSaved={async (id, name) => { setAddedTeam({ id, name }); setEvent(await getEvent(event.id)); }} />}

      <section className="event-section">
        {admin ? <EventForm values={values} pending={pending} submitLabel="Uložit změny" onChange={setValues} onSubmit={() => void runAction(() => updateEvent(event.id, event.revision, values), 'Změny akce byly uloženy.')} /> : (
          <dl className="event-readonly-grid"><div><dt>Místo</dt><dd>{event.venue.name}</dd></div><div><dt>Veřejná lokalita</dt><dd>{event.venue.publicLocation}</dd></div><div><dt>Kapacita týmů</dt><dd>{event.teamCapacity}</dd></div><div><dt>Kapacita lidí</dt><dd>{event.peopleCapacity}</dd></div><div><dt>Velikost týmu</dt><dd>{event.teamSizeMin}–{event.teamSizeMax}</dd></div></dl>
        )}
      </section>

      <section className="event-section" data-testid="event-quiz-assignment">
        <div className="event-section-heading"><div><p className="eyebrow">Kvíz</p><h2>{locked ? 'Kvíz připraven' : 'Vybrat kvíz'}</h2></div>{locked && <span>Zdrojová revize {locked.quizRevision}</span>}</div>
        {locked && <div className="event-locked-quiz"><strong>{locked.quizTitle}</strong><span>{locked.roundCount} kol · {locked.questionCount} otázek</span><small>Snapshot je privátní a nemění se při dalších úpravách zdrojového kvízu.</small></div>}
        {canChooseQuiz ? (
          <div className="event-quiz-lock">
            <label className="editor-field"><span>{locked ? 'Aktualizovat kvíz pro akci' : 'Kvíz'}</span><select value={selectedQuizId} onChange={(change) => setSelectedQuizId(change.target.value)}><option value="">Vyberte kvíz</option>{quizzes.map((quiz) => <option value={quiz.id} key={quiz.id}>{quiz.title}</option>)}</select></label>
            {selectedQuiz && preflight && <div className={`event-readiness status-${preflight.status.toLowerCase()}`} data-preflight-status={preflight.status}><strong>{selectedQuiz.title}</strong><span>{preflight.roundCount} kol · {preflight.questionCount} otázek</span><p>{preflight.blockerCount > 0 ? `${preflight.blockerCount} blockerů brání přípravě.` : preflight.warningCount > 0 ? `${preflight.warningCount} upozornění vyžaduje potvrzení.` : 'Kvíz je připraven bez blockerů.'}</p>{preflight.blockerCount > 0 && <Link className="secondary-link" to={`/admin/quizzes/${selectedQuiz.id}/readiness`}>Otevřít kontrolu kvízu</Link>}{preflight.warningCount > 0 && preflight.blockerCount === 0 && <label className="warning-confirmation"><input type="checkbox" checked={acknowledgeWarnings} onChange={(change) => setAcknowledgeWarnings(change.target.checked)} /> Potvrzuji upozornění pro tuto revizi kvízu.</label>}</div>}
            <button className="primary-button" type="button" disabled={lockDisabled} onClick={() => {
              if (!selectedQuiz) return;
              void runAction(() => lockEventQuiz(event.id, event.revision, selectedQuiz.id, selectedQuiz.revision, acknowledgeWarnings), locked ? 'Kvíz pro akci byl aktualizován novým snapshotem.' : 'Kvíz byl zkontrolován a připraven.');
            }}>{pending ? 'Připravuji…' : locked ? 'Aktualizovat kvíz pro akci' : 'Zkontrolovat a připravit'}</button>
          </div>
        ) : <p className="event-muted">Výběr zdrojového kvízu vyžaduje správu akce a přístup ke kvízu včetně odpovědí a exportu.</p>}
      </section>

      <section className="event-section">
        <div className="event-section-heading"><div><p className="eyebrow">Dokumenty</p><h2>Tiskové centrum</h2></div>{locked && <span>Neměnný snapshot</span>}</div>
        <p className="event-muted">Hrací archy, privátní klíč odpovědí a bodovací tabulka pro ruční práci na místě.</p>
        {can('event.export') && <Link className="secondary-link" to={`/admin/events/${event.id}/print`}>Otevřít tiskové centrum</Link>}
      </section>

      {can('event.live') && locked && ['ready', 'live', 'finalizing'].includes(event.lifecycleStatus) && <EventLiveButton eventId={event.id} revision={event.revision} />}
      {admin && !['archived', 'cancelled', 'completed'].includes(event.lifecycleStatus) && <RefereeAccessPanel eventId={event.id} />}
    {admin && <section className="event-section event-danger-zone"><div><p className="eyebrow">Stav akce</p><h2>Bezpečné ukončení</h2></div>{event.lifecycleStatus === 'cancelled' ? <button className="secondary-button" type="button" disabled={pending} onClick={() => void runAction(() => archiveEvent(event.id, event.revision), 'Akce byla archivována.')}>Archivovat akci</button> : event.lifecycleStatus !== 'archived' && event.lifecycleStatus !== 'completed' ? <button className="danger-button" type="button" disabled={pending} onClick={() => { if (window.confirm('Opravdu zrušit tuto akci? Veřejná projekce bude odstraněna.')) void runAction(() => cancelEvent(event.id, event.revision), 'Akce byla zrušena.'); }}>Zrušit akci</button> : null}</section>}
    </article>
  );
}
