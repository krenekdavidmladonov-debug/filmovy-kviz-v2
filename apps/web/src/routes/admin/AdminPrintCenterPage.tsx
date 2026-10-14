import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { useAuth } from '../../auth/AuthProvider';
import { getEvent } from '../../features/events/eventRepository';
import { privateRead, type PrivateDocument } from '../../features/access/api';
import type { EventRecord, RegistrationRecord } from '../../features/events/types';
import { generatePrintArtifact } from '../../features/print/printApi';
import type { PrintArtifactType, PrintOptions, TeamSheetMode } from '../../features/print/types';
import { QuizErrorState } from '../../features/quizzes/QuizErrorState';
import { QuizLoading } from '../../features/quizzes/QuizLoading';

const ARTIFACTS = [
  { type: 'team-sheets', title: 'Hrací archy', description: 'A4 odpovědní listy s prostorem pro psaní a označením týmu na každé straně.' },
  { type: 'answer-key', title: 'Klíč odpovědí', description: 'Privátní přehled správných odpovědí pro administrátora.' },
  { type: 'score-table', title: 'Bodovací tabulka', description: 'Tabulka kol, půlbodů a celkového součtu.' },
] as const;

interface Preview { readonly url: string; readonly filename: string }

function optionsFor(type: PrintArtifactType, mode: TeamSheetMode, teamId: string): PrintOptions {
  if (type === 'answer-key') return { artifactType: type, disposition: 'inline' };
  if (type === 'score-table') return { artifactType: type, disposition: 'inline' };
  return mode === 'single'
    ? { artifactType: type, disposition: 'inline', mode, teamId }
    : { artifactType: type, disposition: 'inline', mode };
}

export function AdminPrintCenterPage() {
  const { eventId } = useParams<{ eventId: string }>();
  const { can } = useAuth();
  const previewFrame = useRef<HTMLIFrameElement>(null);
  const [event, setEvent] = useState<EventRecord | null>(null);
  const [registrations, setRegistrations] = useState<readonly Pick<RegistrationRecord, 'id' | 'teamName'>[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [artifactType, setArtifactType] = useState<PrintArtifactType>('team-sheets');
  const [teamMode, setTeamMode] = useState<TeamSheetMode>('generic');
  const [teamId, setTeamId] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [pending, setPending] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!eventId) return;
    setLoading(true);
    setLoadError(null);
    try {
      const [nextEvent, roster] = await Promise.all([getEvent(eventId), privateRead<PrivateDocument[]>('roster', { eventId })]);
      const nextRegistrations = roster.filter(item => item.data.status === 'accepted').map(item => ({ id: item.id, teamName: typeof item.data.teamName === 'string' ? item.data.teamName : '' }));
      setEvent(nextEvent);
      setRegistrations(nextRegistrations);
      setTeamId((current) => current || nextRegistrations[0]?.id || '');
    }
    catch { setLoadError('Tiskové centrum se nepodařilo načíst.'); }
    finally { setLoading(false); }
  }, [eventId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url); }, [preview]);

  const options = useMemo(() => optionsFor(artifactType, teamMode, teamId), [artifactType, teamMode, teamId]);
  const teamCount = registrations.length;
  const formInvalid = (artifactType === 'score-table' && (teamCount < 1 || teamCount > 30))
    || (artifactType === 'team-sheets' && teamMode === 'single' && !teamId)
    || (artifactType === 'team-sheets' && teamMode === 'all' && (teamCount < 1 || teamCount > 30));

  const clearPreview = () => {
    setPreview((current) => { if (current) URL.revokeObjectURL(current.url); return null; });
    setGenerationError(null);
  };

  const generate = async () => {
    if (!eventId || formInvalid || !event?.quizAssignment) return;
    setPending(true);
    setGenerationError(null);
    try {
      const result = await generatePrintArtifact(eventId, options);
      const url = URL.createObjectURL(result.blob);
      setPreview((current) => { if (current) URL.revokeObjectURL(current.url); return { url, filename: result.filename }; });
    } catch (error: unknown) {
      setGenerationError(error instanceof Error ? error.message : 'PDF se nepodařilo vytvořit.');
    } finally { setPending(false); }
  };

  if (loading) return <QuizLoading label="Načítám tiskové centrum…" />;
  if (loadError) return <QuizErrorState message={loadError} onRetry={() => void load()} />;
  if (!event) return <section className="quiz-state-card"><div><h2>Akce neexistuje</h2><p>Požadovaný záznam nebyl nalezen.</p></div><Link className="secondary-link" to="/admin/events">Zpět na akce</Link></section>;

  return (
    <article className="print-center-page">
      <Link className="back-link" to={`/admin/events/${event.id}`}>← Zpět na akci</Link>
      <header className="event-page-heading">
        <div><p className="eyebrow">Akce · Tiskové centrum</p><h1>{event.title}</h1><p className="lead">Vyberte dokument, zkontrolujte náhled a použijte stejný soubor pro stažení nebo tisk.</p></div>
        {event.quizAssignment && <span className="quiz-status status-ready">Snapshot připraven</span>}
      </header>

      {!event.quizAssignment ? (
        <section className="event-section print-lock-message" role="status">
          <div><p className="eyebrow">Tisk zatím není dostupný</p><h2>Nejdříve uzamkněte kvíz pro tuto akci</h2><p>PDF vždy vychází z neměnného snapshotu. Vraťte se na detail akce, vyberte kvíz a použijte „Zkontrolovat a připravit“.</p></div>
          <Link className="primary-button" to={`/admin/events/${event.id}`}>Přejít na detail akce</Link>
        </section>
      ) : <>
        <section className="print-artifact-grid" aria-label="Typ dokumentu">
          {ARTIFACTS.map((artifact) => {
            const restricted = !can('event.export') || (artifact.type === 'answer-key' && (!can('event.answers.read') || !can('event.answers.export')));
            return <button key={artifact.type} type="button" className={`print-artifact-card${artifactType === artifact.type ? ' is-selected' : ''}`} disabled={restricted} aria-pressed={artifactType === artifact.type} onClick={() => { setArtifactType(artifact.type); clearPreview(); }}><strong>{artifact.title}</strong><span>{artifact.description}</span>{restricted && <small>Pouze administrátor</small>}</button>;
          })}
        </section>

        <section className="print-workspace">
          <div className="event-section print-settings">
            <div><p className="eyebrow">Nastavení</p><h2>{ARTIFACTS.find((artifact) => artifact.type === artifactType)?.title}</h2></div>
            <p className="event-muted">Nadpis, pokyny, patičku, logo a hustotu archů nastavíte v editoru kvízu. PDF přebírá vzhled uložený při přípravě této akce.</p>
            <p className="event-muted">Tiskněte na A4 v měřítku 100 %. Bílé pozadí a jemné linky zůstávají čitelné i černobíle.</p>
            {artifactType === 'team-sheets' && <fieldset className="print-mode"><legend>Varianta archu</legend>{([
              ['generic', 'Obecný arch'], ['single', 'Jeden tým'], ['all', 'Všechny týmy'],
            ] as const).map(([value, label]) => <label key={value}><input type="radio" name="team-mode" value={value} checked={teamMode === value} onChange={() => { setTeamMode(value); clearPreview(); }} /> {label}</label>)}</fieldset>}
            {artifactType === 'team-sheets' && teamMode === 'single' && <label className="editor-field"><span>Tým</span><select value={teamId} onChange={(change) => { setTeamId(change.target.value); clearPreview(); }}><option value="">Vyberte přijatý tým</option>{registrations.map((team) => <option key={team.id} value={team.id}>{team.teamName}</option>)}</select></label>}
            {(artifactType === 'score-table' || (artifactType === 'team-sheets' && teamMode === 'all')) && <p className="event-muted">Server použije {teamCount} přijatých týmů. Zrušené týmy a kontaktní e-maily do PDF nevstupují.</p>}
            {artifactType === 'answer-key' && <p className="print-private-note">Privátní dokument. Odpovědi načte server ze snapshotu a browser je nikdy neposílá.</p>}
            {formInvalid && <p className="round-editor-error" role="alert">{teamMode === 'single' && artifactType === 'team-sheets' ? 'Vyberte přijatý tým.' : 'Pro tuto variantu je potřeba 1 až 30 přijatých týmů.'}</p>}
            {generationError && <p className="round-editor-error" role="alert">{generationError}</p>}
            <button className="primary-button" type="button" disabled={pending || formInvalid} onClick={() => void generate()}>{pending ? 'Generuji PDF…' : preview ? 'Obnovit náhled' : 'Vytvořit náhled'}</button>
          </div>

          <section className="event-section print-preview-panel">
            <div className="event-section-heading"><div><p className="eyebrow">PDF preview</p><h2>Náhled dokumentu</h2></div>{preview && <span>Stejná data pro tisk i stažení</span>}</div>
            {preview ? <iframe ref={previewFrame} className="print-preview-frame" title="Náhled PDF" src={preview.url} /> : <div className="print-preview-empty"><strong>Náhled ještě není vytvořený</strong><span>PDF vznikne až na zabezpečeném serveru z uzamčeného snapshotu.</span></div>}
            <div className="print-actions">
              <a className="secondary-link" aria-disabled={!preview} href={preview?.url} download={preview?.filename}>Stáhnout PDF</a>
              <button className="secondary-button" type="button" disabled={!preview} onClick={() => previewFrame.current?.contentWindow?.print()}>Vytisknout</button>
              <button className="secondary-button" type="button" disabled={!preview || pending} onClick={() => void generate()}>Obnovit náhled</button>
            </div>
          </section>
        </section>
      </>}
    </article>
  );
}
