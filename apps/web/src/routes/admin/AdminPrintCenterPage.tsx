import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { useAuth } from '../../auth/AuthProvider';
import { getEvent } from '../../features/events/eventRepository';
import type { EventRecord } from '../../features/events/types';
import { generatePrintArtifact } from '../../features/print/printApi';
import type { PrintArtifactType, PrintOptions, PrintTeam, TeamSheetMode } from '../../features/print/types';
import { QuizErrorState } from '../../features/quizzes/QuizErrorState';
import { QuizLoading } from '../../features/quizzes/QuizLoading';

const SYNTHETIC_TEAMS = Array.from({ length: 20 }, (_, index) => `Tým ${String(index + 1).padStart(2, '0')}`).join('\n');
const ARTIFACTS = [
  { type: 'team-sheets', title: 'Hrací archy', description: 'Čisté archy pro ruční odpovědi týmů.' },
  { type: 'answer-key', title: 'Klíč odpovědí', description: 'Privátní přehled správných odpovědí pro administrátora.' },
  { type: 'score-table', title: 'Bodovací tabulka', description: 'Tabulka kol, půlbodů a celkového součtu.' },
] as const;

interface Preview { readonly url: string; readonly filename: string }

function teamsFromText(value: string): PrintTeam[] {
  return value.split(/\r?\n/u).map((name) => name.trim()).filter(Boolean).map((name) => ({ name }));
}

function optionsFor(type: PrintArtifactType, mode: TeamSheetMode, teamText: string): PrintOptions {
  if (type === 'answer-key') return { artifactType: type, disposition: 'inline' };
  const teams = teamsFromText(teamText);
  if (type === 'score-table') return { artifactType: type, disposition: 'inline', teams };
  return { artifactType: type, disposition: 'inline', mode, teams: mode === 'generic' ? [] : mode === 'single' ? teams.slice(0, 1) : teams };
}

export function AdminPrintCenterPage() {
  const { eventId } = useParams<{ eventId: string }>();
  const { role } = useAuth();
  const previewFrame = useRef<HTMLIFrameElement>(null);
  const [event, setEvent] = useState<EventRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [artifactType, setArtifactType] = useState<PrintArtifactType>('team-sheets');
  const [teamMode, setTeamMode] = useState<TeamSheetMode>('generic');
  const [teamText, setTeamText] = useState(SYNTHETIC_TEAMS);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [pending, setPending] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!eventId) return;
    setLoading(true);
    setLoadError(null);
    try { setEvent(await getEvent(eventId)); }
    catch { setLoadError('Tiskové centrum se nepodařilo načíst.'); }
    finally { setLoading(false); }
  }, [eventId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url); }, [preview]);

  const options = useMemo(() => optionsFor(artifactType, teamMode, teamText), [artifactType, teamMode, teamText]);
  const teamCount = 'teams' in options ? options.teams.length : 0;
  const formInvalid = (artifactType === 'score-table' && (teamCount < 1 || teamCount > 30))
    || (artifactType === 'team-sheets' && teamMode !== 'generic' && (teamCount < 1 || teamCount > 30));

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
            const restricted = artifact.type === 'answer-key' && role !== 'admin';
            return <button key={artifact.type} type="button" className={`print-artifact-card${artifactType === artifact.type ? ' is-selected' : ''}`} disabled={restricted} aria-pressed={artifactType === artifact.type} onClick={() => { setArtifactType(artifact.type); clearPreview(); }}><strong>{artifact.title}</strong><span>{artifact.description}</span>{restricted && <small>Pouze administrátor</small>}</button>;
          })}
        </section>

        <section className="print-workspace">
          <div className="event-section print-settings">
            <div><p className="eyebrow">Nastavení</p><h2>{ARTIFACTS.find((artifact) => artifact.type === artifactType)?.title}</h2></div>
            {artifactType === 'team-sheets' && <fieldset className="print-mode"><legend>Varianta archu</legend>{([
              ['generic', 'Obecný arch'], ['single', 'Jeden tým'], ['all', 'Všechny týmy'],
            ] as const).map(([value, label]) => <label key={value}><input type="radio" name="team-mode" value={value} checked={teamMode === value} onChange={() => { setTeamMode(value); clearPreview(); }} /> {label}</label>)}</fieldset>}
            {(artifactType === 'score-table' || (artifactType === 'team-sheets' && teamMode !== 'generic')) && <label className="editor-field"><span>{teamMode === 'single' && artifactType === 'team-sheets' ? 'Tým' : 'Týmy — jeden na řádek'}</span><textarea rows={artifactType === 'score-table' || teamMode === 'all' ? 10 : 3} value={teamText} onChange={(change) => { setTeamText(change.target.value); clearPreview(); }} /><small>{teamCount} / 30 týmů. Zatím jde o typed syntetický vstup bez kontaktů.</small></label>}
            {artifactType === 'answer-key' && <p className="print-private-note">Privátní dokument. Odpovědi načte server ze snapshotu a browser je nikdy neposílá.</p>}
            {formInvalid && <p className="round-editor-error" role="alert">Zadejte 1 až 30 týmů, každý na samostatný řádek.</p>}
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
