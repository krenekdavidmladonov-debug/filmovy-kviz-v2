import { FirebaseError } from 'firebase/app';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { getEditorQuiz } from '../../features/editor/editorRepository';
import type { EditorQuiz } from '../../features/editor/types';
import { createLiveSession } from '../../features/live/liveApi';
import { QuizPreflightPanel } from '../../features/preflight/QuizPreflightPanel';
import { runQuizPreflight } from '../../features/preflight/validation';
import { QuizErrorState } from '../../features/quizzes/QuizErrorState';
import { QuizLoading } from '../../features/quizzes/QuizLoading';
import { HumanError, type HumanErrorValue } from '../../ui/HumanError';

export function QuizPreflightPage() {
  const { quizId } = useParams<{ quizId: string }>();
  const navigate = useNavigate();
  const [quiz, setQuiz] = useState<EditorQuiz | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [starting, setStarting] = useState(false);
  const [confirmWarnings, setConfirmWarnings] = useState(false);
  const [warningConfirmationRevision, setWarningConfirmationRevision] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [startError, setStartError] = useState<HumanErrorValue | null>(null);
  const result = useMemo(() => quiz === null ? null : runQuizPreflight(quiz), [quiz]);

  const load = useCallback(async () => {
    if (!quizId) {
      setNotFound(true);
      setLoading(false);
      return null;
    }
    setLoading(true);
    setError(null);
    setStartError(null);
    setConfirmWarnings(false);
    setWarningConfirmationRevision(null);
    try {
      const loaded = await getEditorQuiz(quizId);
      setQuiz(loaded);
      setNotFound(loaded === null);
      return loaded;
    } catch {
      setError('Kontrolu připravenosti se nepodařilo načíst. Zkontrolujte připojení a zkuste to znovu.');
      return null;
    } finally {
      setLoading(false);
    }
  }, [quizId]);

  useEffect(() => { void load(); }, [load]);

  async function startQuiz(warningsConfirmed = false) {
    if (!quizId) return;
    setStarting(true);
    setStartError(null);
    try {
      const latest = await getEditorQuiz(quizId);
      if (latest === null) {
        setNotFound(true);
        return;
      }
      setQuiz(latest);
      const latestResult = runQuizPreflight(latest);
      if (latestResult.blockerCount > 0) {
        setConfirmWarnings(false);
        setWarningConfirmationRevision(null);
        return;
      }
      if (latestResult.warningCount > 0
        && (!warningsConfirmed || warningConfirmationRevision !== latest.revision)) {
        setConfirmWarnings(true);
        setWarningConfirmationRevision(latest.revision);
        return;
      }
      setWarningConfirmationRevision(null);
      const session = await createLiveSession(quizId);
      void navigate(`/admin/live/${encodeURIComponent(session.sessionId)}`);
    } catch (failure) {
      setStartError({
        title: 'Kvíz se nepodařilo spustit',
        message: 'Kvíz zůstal beze změny. Zkontrolujte připojení a zkuste to znovu.',
        technicalCode: failure instanceof FirebaseError
          ? failure.code.toUpperCase().replaceAll('/', '_').replaceAll('-', '_')
          : 'LIVE_SESSION_CREATE_FAILED',
      });
    } finally {
      setStarting(false);
    }
  }

  if (loading && quiz === null) return <QuizLoading label="Kontroluji připravenost celého kvízu…" />;
  if (error) return <QuizErrorState message={error} onRetry={() => void load()} />;
  if (notFound || quiz === null || result === null) {
    return <QuizErrorState message="Kvíz nebyl nalezen." onRetry={() => void load()} />;
  }

  return (
    <article className="quiz-preflight-page">
      <Link className="back-link" to={`/admin/quizzes/${encodeURIComponent(quiz.id)}`}>← Detail kvízu</Link>
      <QuizPreflightPanel quizId={quiz.id} result={result} onRecheck={() => void load()} />
      <section className="preflight-start-card" aria-label="Spuštění kvízu">
        {result.blockerCount > 0 ? (
          <>
            <strong>Kvíz zatím nelze spustit.</strong>
            <p>Opravte {result.blockerCount} {result.blockerCount === 1 ? 'blokující problém' : 'blokující problémy'}.</p>
            <Link className="button-link repair-entry-link" to={`/admin/quizzes/${encodeURIComponent(quiz.id)}/readiness/repair`}>Opravit blokující problémy</Link>
            <button type="button" className="primary-button" disabled>Kvíz nelze spustit</button>
          </>
        ) : result.warningCount > 0 ? (
          confirmWarnings ? (
            <div className="warning-confirmation" role="alertdialog" aria-labelledby="warning-confirmation-title">
              <strong id="warning-confirmation-title">Kvíz má {result.warningCount} upozornění.</strong>
              <p>Externí média nejsou garantovaná. Opravdu chcete pokračovat?</p>
              <div>
                <button type="button" className="primary-button" disabled={starting} onClick={() => void startQuiz(true)}>{starting ? 'Spouštím…' : 'Potvrdit a spustit'}</button>
                <button type="button" className="secondary-button" disabled={starting} onClick={() => { setConfirmWarnings(false); setWarningConfirmationRevision(null); }}>Zrušit</button>
              </div>
            </div>
          ) : (
            <>
              <strong>Kvíz lze spustit, ale má upozornění.</strong>
              <p>Před pokračováním si je projděte.</p>
              <button type="button" className="primary-button" disabled={starting} onClick={() => void startQuiz()}>{starting ? 'Kontroluji…' : 'Spustit i tak'}</button>
            </>
          )
        ) : (
          <>
            <strong>Kvíz je připraven.</strong>
            <p>Před spuštěním se stav ještě jednou načte a zkontroluje.</p>
            <button type="button" className="primary-button" disabled={starting} onClick={() => void startQuiz()}>{starting ? 'Spouštím…' : 'Spustit kvíz'}</button>
          </>
        )}
        {startError && <HumanError error={startError} onRetry={() => void startQuiz(result.warningCount > 0)} />}
      </section>
    </article>
  );
}
