import { eventDisposition, eventOperational, pragueDateTime } from '@filmovy-kviz/quiz-domain';
import { EventActions, lifecycleLabels } from '../../features/events/EventActions';
import { teamEmailEnabled } from '../../features/events/teamEmailCapability';
import { EventLiveButton } from '../../features/leaderboard/EventLiveButton';
import { RefereeAccessPanel } from '../../features/referee/RefereeAccessPanel';
import { runQuizPreflight, type EditorQuiz, type PreflightResult } from '@filmovy-kviz/quiz-domain';
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { useAuth } from '../../auth/AuthProvider';
import {
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

const localDateTime = pragueDateTime;

function formValues(event: EventRecord): EventFormValues {
  return {
    title: event.title,
    description: event.description ?? '',
    utcOffset: new Intl.DateTimeFormat('en', { timeZone: 'Europe/Prague', timeZoneName: 'shortOffset' }).format(event.startsAt).includes('GMT+2') ? '+02:00' : '+01:00',
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
  const navigate = useNavigate();
  const { eventId } = useParams<{ eventId: string }>();
  const { can, currentUser } = useAuth();
  const canChooseQuiz = can('event.manage') && can('quiz.read') && can('quiz.export') && can('quiz.answers.read') && can('quiz.notes.read');
  const [event, setEvent] = useState<EventRecord | null>(null);
  const [values, setValues] = useState<EventFormValues | null>(null);
  const [quizzes, setQuizzes] = useState<readonly QuizSummary[]>([]);
  const [quizzesLoading, setQuizzesLoading] = useState(false);
  const [quizzesError, setQuizzesError] = useState(false);
  const [selectedQuizId, setSelectedQuizId] = useState('');
  const [selectedQuiz, setSelectedQuiz] = useState<EditorQuiz | null>(null);
  const [preflight, setPreflight] = useState<PreflightResult | null>(null);
  const [acknowledgeWarnings, setAcknowledgeWarnings] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [addingTeam, setAddingTeam] = useState(false);
  const [addedTeam, setAddedTeam] = useState<{ id: string; name: string } | null>(null);
  const loadVersion = useRef(0);
  const quizEditable = !loading && event?.id === eventId && event !== null && canChooseQuiz
    && eventOperational(event) && !event.liveSessionId && !event.scoring.started;

  const load = useCallback(async () => {
    if (!eventId) return;
    const version = ++loadVersion.current;
    setLoading(true);
    setError(null);
    try {
      const loadedEvent = await getEvent(eventId);
      if (version !== loadVersion.current) return;
      setEvent(loadedEvent);
      setValues(loadedEvent ? formValues(loadedEvent) : null);
      if (loadedEvent?.quizAssignment) {
        setSelectedQuizId((current) => current === '' ? loadedEvent.quizAssignment?.quizId ?? '' : current);
      }
    } catch {
      if (version === loadVersion.current) setError('Detail akce se nepodařilo načíst.');
    } finally {
      if (version === loadVersion.current) setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    setEvent(null);
    setSelectedQuizId('');
    void load();
    return () => { loadVersion.current++; };
  }, [load]);
  useEffect(() => {
    let current = true;
    setQuizzes([]);
    setQuizzesError(false);
    setQuizzesLoading(quizEditable);
    if (quizEditable) {
      void listQuizzes().then(items => { if (current) setQuizzes(items); })
        .catch(() => { if (current) setQuizzesError(true); })
        .finally(() => { if (current) setQuizzesLoading(false); });
    }
    return () => { current = false; };
  }, [quizEditable, eventId]);
  useEffect(() => {
    let current = true;
    setAcknowledgeWarnings(false);
    setPreflight(null);
    setSelectedQuiz(null);
    if (!quizEditable || selectedQuizId === '' || !quizzes.some(quiz => quiz.id === selectedQuizId)) return () => { current = false; };
    void getEditorQuiz(selectedQuizId).then((quiz) => {
      if (!current || quiz === null) return;
      setSelectedQuiz(quiz);
      setPreflight(runQuizPreflight(quiz));
    }).catch(() => { if (current) setError('Vybraný kvíz se nepodařilo načíst.'); });
    return () => { current = false; };
  }, [selectedQuizId, quizEditable, quizzes]);

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
      if (actionError && typeof actionError === 'object' && 'code' in actionError && actionError.code === 'functions/aborted') setConflict(true);
    } finally {
      setPending(false);
    }
  };

  if (loading || (event !== null && event.id !== eventId)) return <QuizLoading label="Načítám detail akce…" />;
  if (error && event === null) return <QuizErrorState message={error} onRetry={() => void load()} />;
  if (!event || !values) return <section className="quiz-state-card"><div><h2>Akce neexistuje</h2><p>Požadovaný záznam nebyl nalezen.</p></div><Link className="secondary-link" to="/admin/events">Zpět na akce</Link></section>;

  const admin = can('event.manage') && eventOperational(event);
  const hidden = ['trash', 'deleting'].includes(eventDisposition(event));
  const locked = event.quizAssignment;
  const lockDisabled = pending || !eventOperational(event) || Boolean(event.liveSessionId) || event.scoring.started || selectedQuiz === null || preflight === null
    || preflight.blockerCount > 0 || (preflight.warningCount > 0 && !acknowledgeWarnings);
  return (
    <article className="event-detail-page">
      <Link className="back-link" to="/admin/events">← Zpět na akce</Link>
      <header className="event-page-heading event-form-heading">
        <div><h1>{admin ? 'Upravit akci' : 'Detail akce'}</h1><p className="lead">{event.title} · {event.venue.name}</p></div>
        <span className={`quiz-status status-${event.lifecycleStatus}`}>{lifecycleLabels[event.lifecycleStatus]}</span>
        <EventActions event={event} onChanged={async (message, deleted) => { if (deleted) { await navigate('/admin/events'); return; } await load(); setNotice(message); }} />
      </header>
      {error && <p className="round-editor-error" role="alert">{error}</p>}
      {conflict && <section className="event-section"><p>Novější změnu jsme nepřepsali. Váš rozepsaný formulář zůstal zachovaný.</p><button className="secondary-button" onClick={() => { void getEvent(event.id).then(latest => { if (latest) { const original = formValues(event), incoming = formValues(latest);
        const merged = { ...incoming }; const conflicting: string[] = [];
        for (const key of Object.keys(original) as (keyof EventFormValues)[]) { if (values[key] !== original[key]) { Object.assign(merged, { [key]: values[key] }); if (incoming[key] !== original[key] && incoming[key] !== values[key]) conflicting.push(key + ': na serveru „' + String(incoming[key]) + '“, váš návrh „' + String(values[key]) + '“'); } }
        setValues(merged); setEvent(latest); setConflict(false); setNotice(conflicting.length ? 'Před uložením potvrďte svůj návrh u shodně změněných polí: ' + conflicting.join('; ') : 'Vaše změny byly přeneseny do aktuální verze. Ostatní novější údaje zůstaly zachované. Zkontrolujte formulář a uložte.'); setError(null);  } }); }}>Načíst aktuální stav a ponechat formulář</button></section>}
      {notice && <p className="event-notice" role="status">{notice}</p>}

      {!hidden && can('event.read') && event.lifecycleStatus === 'completed' && <section className="event-section">
        <div className="event-section-heading"><div><p className="eyebrow">Dokončená akce</p><h2>Konečné výsledky</h2></div></div>
        <p className="event-muted">Potvrzené konečné pořadí této akce, pouze pro čtení.</p>
        <Link className="secondary-link" to={`/admin/events/${event.id}/results`}>Otevřít konečné výsledky</Link>
      </section>}

      {!hidden && can('event.contacts') && <section className="event-section">
        <div className="event-section-heading"><div><p className="eyebrow">Registrace</p><h2>Týmy a kapacita</h2></div><span>{event.acceptedTeams} / {event.teamCapacity} týmů</span></div>
        <p className="event-muted">Registrační okno, souhrn osob a privátní kontakty týmů.</p>
        <div className="team-tool-actions">{admin && <button className="primary-button" type="button" onClick={() => setAddingTeam(true)}>+ Přidat tým</button>}<Link className="secondary-link" to={`/admin/events/${event.id}/registrations`}>Spravovat týmy a registrace</Link></div>
        {addedTeam && <p className="event-notice" role="status">Přidán tým: <Link to={`/admin/events/${event.id}/registrations?team=${addedTeam.id}`}>{addedTeam.name}</Link></p>}
      </section>}

      <section className="event-section">
        <div className="event-section-heading"><div><p className="eyebrow">Interní zápis</p><h2>Bodování</h2></div></div>
        <p className="event-muted">Body přijatých týmů za kola připraveného kvízu a historie oprav.</p>
        {!hidden && <Link className="secondary-link" to={`/admin/events/${event.id}/scoring`}>Otevřít bodování</Link>}
      </section>
      {admin && can('event.contacts') && EventTeamMessagePanel && <Suspense fallback={null}><EventTeamMessagePanel key={event.id + ':' + currentUser?.uid} eventId={event.id} actorId={currentUser!.uid} canCreate={['draft', 'scheduled', 'ready', 'live'].includes(event.lifecycleStatus)} /></Suspense>}
      {!hidden && <RegistrationSharePanel event={event} />}
      {admin && addingTeam && <ManualTeamDialog event={event} onClose={() => setAddingTeam(false)} onSaved={async (id, name) => { setAddedTeam({ id, name }); setEvent(await getEvent(event.id)); }} />}

      <section className="event-section" id="event-edit">
        {admin ? <EventForm values={values} live={Boolean(event.liveSessionId)} pending={pending || conflict} submitLabel="Uložit změny" onChange={setValues} onSubmit={() => void runAction(() => updateEvent(event.id, event.revision, values), 'Změny akce byly uloženy.')} /> : (
          <dl className="event-readonly-grid"><div><dt>Místo</dt><dd>{event.venue.name}</dd></div><div><dt>Veřejná lokalita</dt><dd>{event.venue.publicLocation}</dd></div><div><dt>Kapacita týmů</dt><dd>{event.teamCapacity}</dd></div><div><dt>Kapacita lidí</dt><dd>{event.peopleCapacity}</dd></div><div><dt>Velikost týmu</dt><dd>{event.teamSizeMin}–{event.teamSizeMax}</dd></div></dl>
        )}
      </section>

      <section className="event-section" data-testid="event-quiz-assignment">
        <div className="event-section-heading"><div><p className="eyebrow">Kvíz</p><h2>{locked ? 'Kvíz připraven' : 'Vybrat kvíz'}</h2></div>{locked && <span>Zdrojová revize {locked.quizRevision}</span>}</div>
        {locked && <div className="event-locked-quiz"><strong>{locked.quizTitle}</strong><span>{locked.roundCount} kol · {locked.questionCount} otázek</span><small>Snapshot je privátní a nemění se při dalších úpravách zdrojového kvízu.</small></div>}
        {quizEditable ? (
          <div className="event-quiz-lock">
            {quizzesLoading && <p role="status">Načítám nabídku kvízů…</p>}
            {quizzesError && <p role="alert">Nabídku kvízů se nepodařilo načíst. <button type="button" className="secondary-button" onClick={() => void load()}>Zkusit znovu</button></p>}
            <label className="editor-field"><span>{locked ? 'Aktualizovat kvíz pro akci' : 'Kvíz'}</span><select disabled={quizzesLoading || quizzesError} value={selectedQuizId} onChange={(change) => setSelectedQuizId(change.target.value)}><option value="">Vyberte kvíz</option>{quizzes.map((quiz) => <option value={quiz.id} key={quiz.id}>{quiz.title}</option>)}</select></label>
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
        {!hidden && can('event.export') && <Link className="secondary-link" to={`/admin/events/${event.id}/print`}>Otevřít tiskové centrum</Link>}
      </section>

      {eventOperational(event) && can('event.live') && locked && ['ready', 'live', 'finalizing'].includes(event.lifecycleStatus) && <EventLiveButton eventId={event.id} revision={event.revision} />}
      {admin && !['archived', 'cancelled', 'completed'].includes(event.lifecycleStatus) && <RefereeAccessPanel eventId={event.id} canIssue={can('event.score')} />}

    </article>
  );
}
