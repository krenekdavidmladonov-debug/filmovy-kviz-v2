import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../../auth/AuthProvider';
import { privateRead, type PrivateDocument } from '../../features/access/api';
import { getEvent } from '../../features/events/eventRepository';
import type { EventRecord, RegistrationRecord } from '../../features/events/types';
import { generatePrintArtifact } from '../../features/print/printApi';
import type { PrintArtifactType, PrintOptions, TeamSheetMode } from '../../features/print/types';
import { QuizErrorState } from '../../features/quizzes/QuizErrorState';
import { QuizLoading } from '../../features/quizzes/QuizLoading';
import '../../styles/print.css';

const ARTIFACTS = [
  { type: 'team-sheets', title: 'Odpovědní archy pro týmy', description: 'Připravené jméno týmu, čísla otázek a místo na odpovědi.' },
  { type: 'score-table', title: 'Bodovací tabulka', description: 'Přehled přijatých týmů a prostor pro body za každé kolo.' },
  { type: 'answer-key', title: 'Klíč správných odpovědí', description: 'Správné odpovědi pro oprávněnou obsluhu.' },
] as const;
type InheritedVisibility = 'inherit' | 'show' | 'hide';
interface Preview { readonly url: string; readonly filename: string; readonly key: string }

export function AdminPrintCenterPage() {
  const { eventId } = useParams<{ eventId: string }>();
  const { can, currentUser, membership } = useAuth();
  const identityKey = `${currentUser?.uid ?? ''}:${membership?.version ?? ''}`;
  const loadGeneration = useRef(0);
  const loadedEvent = useRef('');
  const [event, setEvent] = useState<EventRecord | null>(null);
  const [registrations, setRegistrations] = useState<readonly Pick<RegistrationRecord, 'id' | 'teamName'>[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [artifactType, setArtifactType] = useState<PrintArtifactType>('team-sheets');
  const [teamMode, setTeamMode] = useState<TeamSheetMode>('all');
  const [teamId, setTeamId] = useState('');
  const [layout, setLayout] = useState<'inherit' | 'compact' | 'spacious'>('inherit');
  const [logo, setLogo] = useState<InheritedVisibility>('inherit');
  const [instructions, setInstructions] = useState<InheritedVisibility>('inherit');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [pending, setPending] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const canExport = can('event.export');
  const canReadAnswers = can('event.answers.read') && can('event.answers.export');

  const load = useCallback(async () => {
    if (!eventId) return;
    const generation = ++loadGeneration.current;
    setLoading(true);
    setLoadError(null);
    try {
      const [nextEvent, roster] = await Promise.all([getEvent(eventId), privateRead<PrivateDocument[]>('roster', { eventId })]);
      if (generation !== loadGeneration.current) return;
      const accepted = roster.filter(item => item.data.status === 'accepted').map(item => ({
        id: item.id, teamName: typeof item.data.teamName === 'string' ? item.data.teamName : '',
      }));
      setEvent(nextEvent);
      setRegistrations(accepted);
      setTeamId(current => accepted.some(team => team.id === current) ? current : accepted[0]?.id ?? '');
      const targetKey = `${identityKey}:${eventId}`;
      const firstLoad = loadedEvent.current !== targetKey;
      loadedEvent.current = targetKey;
      setTeamMode(current => accepted.length === 0 ? 'generic' : firstLoad ? 'all' : current);
    } catch { if (generation === loadGeneration.current) setLoadError('Tisk a materiály se nepodařilo načíst. Zkuste to znovu.'); }
    finally { if (generation === loadGeneration.current) setLoading(false); }
  }, [eventId, identityKey]);
  useEffect(() => { void load(); return () => { loadGeneration.current++; }; }, [load]);

  const options = useMemo<PrintOptions>(() => {
    const presentation = {
      ...(layout === 'inherit' ? {} : { layout }),
      ...(logo === 'inherit' ? {} : { showLogo: logo === 'show' }),
      ...(instructions === 'inherit' ? {} : { showInstructions: instructions === 'show' }),
    };
    return artifactType === 'team-sheets'
      ? { artifactType, disposition: 'inline', mode: teamMode, ...(teamMode === 'single' ? { teamId } : {}), ...presentation }
      : { artifactType, disposition: 'inline', ...presentation };
  }, [artifactType, teamMode, teamId, layout, logo, instructions]);
  const teamCount = registrations.length;
  const formInvalid = (artifactType === 'score-table' && (teamCount === 0 || teamCount > 30))
    || (artifactType === 'team-sheets' && teamMode === 'single' && !teamId)
    || (artifactType === 'team-sheets' && teamMode === 'all' && (teamCount === 0 || teamCount > 30));
  const permitted = canExport && (artifactType !== 'answer-key' || canReadAnswers);
  const requestKey = JSON.stringify([identityKey, eventId, event?.quizAssignment?.snapshotId, registrations, options, retry]);
  const readyPreview = permitted && preview?.key === requestKey ? preview : null;

  // Every preview is the actual server PDF. Abort obsolete requests and never
  // expose an old document after a selection, identity or permission change.
  useEffect(() => {
    setPreview(null);
    setGenerationError(null);
    if (loading || !eventId || !event?.quizAssignment || formInvalid || !permitted) { setPending(false); return; }
    const controller = new AbortController();
    let active = true;
    let objectUrl: string | undefined;
    setPending(true);
    void generatePrintArtifact(eventId, options, controller.signal).then(result => {
      if (!active) return;
      objectUrl = URL.createObjectURL(result.blob);
      setPreview({ url: objectUrl, filename: result.filename, key: requestKey });
    }).catch((error: unknown) => {
      if (active) setGenerationError(error instanceof Error ? error.message : 'PDF se nepodařilo vytvořit. Zkuste to znovu.');
    }).finally(() => { if (active) setPending(false); });
    return () => { active = false; controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [loading, eventId, event?.quizAssignment?.snapshotId, formInvalid, permitted, options, requestKey]);

  if (loading) return <QuizLoading label="Načítám tisk a materiály…" />;
  if (loadError) return <QuizErrorState message={loadError} onRetry={() => void load()} />;
  if (!event) return <section className="quiz-state-card"><div><h2>Akce neexistuje</h2><p>Požadovaný záznam nebyl nalezen.</p></div><Link className="secondary-link" to="/admin/events">Zpět na akce</Link></section>;
  const assignment = event.quizAssignment;
  return (
    <article className="print-center-page">
      <Link className="back-link" to={`/admin/events/${event.id}`}>← Zpět na akci</Link>
      <header className="event-page-heading">
        <div><p className="eyebrow">{event.title}</p><h1>Tisk a materiály</h1><p className="lead">Vyberte materiál. Náhled i stažené PDF budou stejné.</p></div>
        {assignment && <span className="quiz-status status-ready">Kvíz připraven</span>}
      </header>
      {!assignment ? (
        <section className="event-section print-lock-message" role="status">
          <div><h2>Nejdříve připravte kvíz pro tuto akci</h2><p>Na detailu akce vyberte kvíz a použijte „Zkontrolovat a připravit“. Tisk potom použije právě tuto připravenou verzi.</p></div>
          <Link className="primary-button" to={`/admin/events/${event.id}#event-quiz`}>Připravit kvíz</Link>
        </section>
      ) : <>
        <section className="print-artifact-grid" aria-label="Typ dokumentu">
          {ARTIFACTS.map(artifact => {
            const restricted = !canExport || (artifact.type === 'answer-key' && !canReadAnswers);
            return <button key={artifact.type} type="button" className={`print-artifact-card${artifactType === artifact.type ? ' is-selected' : ''}`} disabled={restricted} aria-pressed={artifactType === artifact.type} onClick={() => setArtifactType(artifact.type)}>
              <strong>{artifact.title}</strong><span>{artifact.description}</span>{restricted && <small>Nemáte oprávnění k tomuto dokumentu</small>}
            </button>;
          })}
        </section>
        <section className="print-document-summary" aria-label="Použité podklady">
          <span><strong>{assignment.quizTitle}</strong> · Kola: {assignment.roundCount} · Otázky: {assignment.questionCount}</span>
          <span>{teamCount === 0 ? 'Zatím žádné přijaté týmy' : `Přijaté týmy: ${teamCount}`}</span>
        </section>
        {teamCount === 0 && artifactType !== 'answer-key' && <section className="print-empty-roster" role="status">
          <div><h2>Akce zatím nemá přijaté týmy</h2><p>Prázdný odpovědní arch můžete stáhnout už teď. Jméno týmu dopíšete ručně. Bodovací tabulka bude dostupná po přidání týmů.</p></div>
          <div className="print-inline-actions">
            {artifactType !== 'team-sheets' && <button className="secondary-button" type="button" onClick={() => { setArtifactType('team-sheets'); setTeamMode('generic'); }}>Zobrazit prázdný arch</button>}
            <Link className="secondary-link" to={`/admin/events/${event.id}/registrations`}>Přidat týmy</Link>
          </div>
        </section>}
        <section className="print-preview-panel" aria-label="Náhled a stažení">
          <header className="print-preview-heading">
            <div><h2>{ARTIFACTS.find(item => item.type === artifactType)?.title}</h2><p>A4 · černobílý tisk · měřítko 100 %</p></div>
            <div className="print-actions">
              <a className="primary-button" aria-disabled={!readyPreview} href={readyPreview?.url} download={readyPreview?.filename}>Stáhnout PDF</a>
            </div>
          </header>
          {artifactType === 'answer-key' && <p className="print-private-note">Jen pro obsluhu. Tento dokument obsahuje správné odpovědi; nedávejte ho hráčům.</p>}
          {generationError ? <div className="print-preview-message" role="alert"><strong>PDF se nepodařilo připravit</strong><p>{generationError}</p><button className="secondary-button" type="button" onClick={() => setRetry(value => value + 1)}>Zkusit znovu</button></div>
            : formInvalid ? <div className="print-preview-message" role="status"><strong>{teamCount > 30 ? artifactType === 'score-table' ? 'Bodovací tabulka podporuje nejvýše 30 týmů' : 'Vyberte jeden tým nebo prázdný arch' : 'Pro tento dokument nejprve přidejte tým'}</strong><p>{teamCount > 30 ? artifactType === 'score-table' ? 'Tato akce má více přijatých týmů, než lze zahrnout do jedné bodovací tabulky.' : 'Jedno PDF podporuje nejvýše 30 přijatých týmů.' : 'Prázdný odpovědní arch je dostupný i bez registrací.'}</p></div>
              : !permitted ? <div className="print-preview-message" role="status">K vytvoření tohoto dokumentu nemáte oprávnění.</div>
                : readyPreview ? <iframe className="print-preview-frame" title="Náhled PDF" src={`${readyPreview.url}#navpanes=0&view=Fit`} />
                  : <div className="print-preview-message" role="status" aria-busy={pending}><strong>Připravuji náhled PDF…</strong><p>Načítám připravený kvíz a aktuální přijaté týmy.</p></div>}
        </section>
        <details className="print-advanced">
          <summary>Pokročilé nastavení</summary>
          <div className="print-advanced-content">
            {artifactType === 'team-sheets' && <fieldset className="print-mode"><legend>Archy pro</legend>{([
              ['all', 'Všechny přijaté týmy'], ['single', 'Jeden tým'], ['generic', 'Prázdný arch bez jména'],
            ] as const).map(([value, label]) => <label key={value}><input type="radio" name="team-mode" value={value} checked={teamMode === value} onChange={() => setTeamMode(value)} />{label}</label>)}</fieldset>}
            {artifactType === 'team-sheets' && teamMode === 'single' && <label className="form-field">Tým<select value={teamId} onChange={change => setTeamId(change.target.value)}>{registrations.map(team => <option key={team.id} value={team.id}>{team.teamName}</option>)}</select></label>}
            {artifactType === 'team-sheets' && <label className="form-field">Prostor na odpovědi<select value={layout} onChange={change => setLayout(change.target.value as typeof layout)}><option value="inherit">Podle připraveného kvízu</option><option value="spacious">Prostorné - nové kolo na nové straně</option><option value="compact">Úsporné - kola navazují</option></select></label>}
            <label className="form-field">Logo v záhlaví<select value={logo} onChange={change => setLogo(change.target.value as InheritedVisibility)}><option value="inherit">Podle připraveného kvízu</option><option value="show">Zobrazit</option><option value="hide">Skrýt</option></select></label>
            {artifactType === 'team-sheets' && <label className="form-field">Pokyny pro týmy<select value={instructions} onChange={change => setInstructions(change.target.value as InheritedVisibility)}><option value="inherit">Podle připraveného kvízu</option><option value="show">Zobrazit</option><option value="hide">Skrýt</option></select></label>}
            <p className="field-help">Tyto volby platí jen pro stažený dokument. Připravený kvíz ani týmy se nemění.</p>
            <button className="secondary-button" type="button" onClick={() => void load()}>Aktualizovat týmy a náhled</button>
          </div>
        </details>
      </>}
    </article>
  );
}
