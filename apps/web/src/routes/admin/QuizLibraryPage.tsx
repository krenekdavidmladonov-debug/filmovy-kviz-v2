import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { QuizErrorState } from '../../features/quizzes/QuizErrorState';
import { QuizLoading } from '../../features/quizzes/QuizLoading';
import { formatQuizDate, getQuizDataError, quizStatusLabels } from '../../features/quizzes/presentation';
import { listQuizzes } from '../../features/quizzes/quizRepository';
import type { QuizSummary } from '../../features/quizzes/types';

export function QuizLibraryPage() {
  const [quizzes, setQuizzes] = useState<readonly QuizSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadQuizzes = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      setQuizzes(await listQuizzes());
    } catch (loadError) {
      setError(getQuizDataError(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadQuizzes();
  }, [loadQuizzes]);

  if (loading) {
    return <QuizLoading />;
  }

  if (error) {
    return <QuizErrorState message={error} onRetry={() => void loadQuizzes()} />;
  }

  return (
    <section className="quiz-library">
      <header className="section-heading">
        <div>
          <p className="eyebrow">Administrace · Kvízy</p>
          <h1>Knihovna kvízů</h1>
          <p className="lead">Přehled připravených, rozpracovaných a archivovaných filmových kvízů.</p>
        </div>
        <div className="section-summary" aria-label="Souhrn knihovny">
          <strong>{quizzes.length}</strong>
          <span>{quizzes.length === 1 ? 'kvíz' : quizzes.length < 5 ? 'kvízy' : 'kvízů'}</span>
        </div>
      </header>

      {quizzes.length === 0 ? (
        <div className="quiz-state-card">
          <span className="state-symbol" aria-hidden="true">0</span>
          <div>
            <h2>Knihovna je prázdná</h2>
            <p>Spusťte emulator-only seed příkaz a potom načtení zopakujte.</p>
          </div>
          <button className="secondary-button" type="button" onClick={() => void loadQuizzes()}>
            Načíst znovu
          </button>
        </div>
      ) : (
        <div className="quiz-table-wrap">
          <table className="quiz-table">
            <thead>
              <tr>
                <th>Kvíz</th>
                <th>Stav</th>
                <th>Kola</th>
                <th>Otázky</th>
                <th>Poslední úprava</th>
                <th><span className="visually-hidden">Otevřít</span></th>
              </tr>
            </thead>
            <tbody>
              {quizzes.map((quiz) => (
                <tr key={quiz.id}>
                  <td data-label="Kvíz">
                    <Link className="quiz-title-link" to={`/admin/quizzes/${quiz.id}`}>{quiz.title}</Link>
                    <span className="quiz-description">{quiz.description}</span>
                  </td>
                  <td data-label="Stav"><span className={`quiz-status status-${quiz.status}`}>{quizStatusLabels[quiz.status]}</span></td>
                  <td data-label="Kola">{quiz.roundCount}</td>
                  <td data-label="Otázky">{quiz.questionCount}</td>
                  <td data-label="Poslední úprava">{formatQuizDate(quiz.updatedAt)}</td>
                  <td className="row-action"><Link to={`/admin/quizzes/${quiz.id}`} aria-label={`Otevřít kvíz ${quiz.title}`}>→</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
