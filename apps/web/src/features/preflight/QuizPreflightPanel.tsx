import { Link } from 'react-router-dom';

import { questionTypeLabels } from '../editor/semanticModel';
import type { PreflightFixTarget, PreflightIssue, PreflightResult } from './types';
import { preflightFixUrl } from './validation';

const categoryLabels = {
  STRUCTURE: 'Struktura',
  ANSWER: 'Správné odpovědi',
  MEDIA: 'Média',
  TIMING: 'Časování',
  IMAGE: 'Obrázky',
  LEGACY: 'Starší obsah',
  PROJECTOR: 'Projektor',
} as const;

function issueHeading(issue: PreflightIssue): string {
  const { reference } = issue;
  if (reference.questionNumber !== undefined && reference.questionType !== undefined) {
    return `${questionTypeLabels[reference.questionType]} · ${reference.roundPosition ?? '—'}. kolo · Otázka ${reference.questionNumber}`;
  }
  if (reference.roundPosition !== undefined) {
    return `${reference.roundPosition}. kolo · ${reference.roundTitle || 'Bez názvu'}`;
  }
  return 'Celý kvíz';
}

function plural(count: number, one: string, few: string, many: string): string {
  return count === 1 ? one : count > 1 && count < 5 ? few : many;
}

export function QuizPreflightPanel({
  quizId,
  result,
  onRecheck,
  onFix,
}: {
  readonly quizId: string;
  readonly result: PreflightResult;
  readonly onRecheck?: () => void;
  readonly onFix?: (target: PreflightFixTarget) => void;
}) {
  const contentReady = result.blockerCount === 0;
  const statusMessage = result.status === 'BLOCKED'
    ? `Kvíz zatím nelze spustit. Opravte ${result.blockerCount} ${plural(result.blockerCount, 'blokující problém', 'blokující problémy', 'blokujících problémů')}.`
    : result.status === 'READY_WITH_WARNINGS'
      ? 'Kvíz je připraven s upozorněními.'
      : 'Kvíz je připraven.';
  const visibleCategories = Object.entries(result.categories)
    .filter(([, count]) => count.blockers > 0 || count.warnings > 0);

  return (
    <section
      className={`quiz-preflight-panel status-${result.status.toLowerCase()}`}
      aria-labelledby="quiz-preflight-title"
      data-preflight-status={result.status}
      data-blocker-count={result.blockerCount}
      data-warning-count={result.warningCount}
      data-round-count={result.roundCount}
      data-question-count={result.questionCount}
      data-validation-duration-ms={result.validationDurationMs.toFixed(3)}
    >
      <header className="preflight-heading">
        <div>
          <span>PŘIPRAVENOST KVÍZU</span>
          <h1 id="quiz-preflight-title">Je tento kvíz připravený?</h1>
          <p>{result.source === 'LOCAL_DRAFT'
            ? 'Kontrola zahrnuje aktuální lokální draft vybrané položky a uložený zbytek kvízu.'
            : 'Kontrola vychází z aktuálně uloženého kvízu.'}</p>
        </div>
        {onRecheck && <button type="button" className="secondary-button" onClick={onRecheck}>Zkontrolovat znovu</button>}
      </header>

      <div className="preflight-status-grid">
        <section className={contentReady ? 'preflight-check ready' : 'preflight-check blocked'}>
          <span aria-hidden="true">{contentReady ? '✓' : '✕'}</span>
          <div><small>OBSAH KVÍZU</small><strong>{contentReady ? 'Připraven' : 'Vyžaduje opravu'}</strong></div>
        </section>
        <section className="preflight-check neutral">
          <span aria-hidden="true">○</span>
          <div><small>PROJEKTOR</small><strong>Neověřeno</strong><p>Stav projektoru lze spolehlivě určit až v živém řízení.</p></div>
        </section>
      </div>

      <dl className="preflight-metrics">
        <div><dt>Struktura</dt><dd>{result.roundCount} kol · {result.questionCount} otázek</dd></div>
        <div><dt>Správné odpovědi</dt><dd>{result.validAnswerCount} / {result.questionCount}</dd></div>
        <div><dt>Blokery</dt><dd>{result.blockerCount}</dd></div>
        <div><dt>Upozornění</dt><dd>{result.warningCount}</dd></div>
      </dl>

      {visibleCategories.length > 0 && (
        <ul className="preflight-category-list" aria-label="Souhrn oblastí">
          {visibleCategories.map(([category, count]) => (
            <li key={category} data-category={category}>
              <strong>{categoryLabels[category as keyof typeof categoryLabels]}</strong>
              <span>{count.blockers > 0 ? `${count.blockers} blokující` : ''}{count.blockers > 0 && count.warnings > 0 ? ' · ' : ''}{count.warnings > 0 ? `${count.warnings} upozornění` : ''}</span>
            </li>
          ))}
        </ul>
      )}

      {result.issues.length > 0 && (
        <ol className="preflight-issues" aria-label="Nalezené problémy">
          {result.issues.map((issue, index) => (
            <li className={`preflight-issue severity-${issue.severity.toLowerCase()}`} key={`${issue.code}-${issue.reference.questionId ?? issue.reference.roundId ?? 'quiz'}-${index}`} data-issue-code={issue.code} data-issue-category={issue.category}>
              <span className="preflight-severity">{issue.severity === 'BLOCKER' ? 'BLOKUJE START' : 'UPOZORNĚNÍ'}</span>
              <strong>{issueHeading(issue)}</strong>
              <p>{issue.message}</p>
              {issue.fixTarget && (onFix
                ? <button type="button" className="secondary-button compact-button" onClick={() => onFix(issue.fixTarget!)}>Opravit</button>
                : <Link className="secondary-link" to={preflightFixUrl(quizId, issue.fixTarget)}>Opravit</Link>)}
            </li>
          ))}
        </ol>
      )}

      <footer className="preflight-result" role="status" aria-live="polite">
        <strong>{statusMessage}</strong>
        {result.warningCount > 0 && <p>Externí média jsou vždy best-effort online. Kontrola negarantuje dostupnost, přehratelnost ani offline provoz.</p>}
      </footer>
    </section>
  );
}
