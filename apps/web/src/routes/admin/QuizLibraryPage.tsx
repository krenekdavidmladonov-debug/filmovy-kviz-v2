import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { useAuth } from '../../auth/AuthProvider';
import { QuizErrorState } from '../../features/quizzes/QuizErrorState';
import { QuizLoading } from '../../features/quizzes/QuizLoading';
import { formatQuizDate, getQuizDataError, quizStatusLabels } from '../../features/quizzes/presentation';
import { listQuizzes } from '../../features/quizzes/quizRepository';
import type { QuizSummary } from '../../features/quizzes/types';

export function QuizLibraryPage() {
  const { can } = useAuth();
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
          <p className="eyebrow">Administrace</p>
          <h1>Kvízy</h1>
          <p className="lead">Připravené, rozpracované a archivované kvízy na jednom místě.</p>
        </div>
        <div className="quiz-library-actions">
          {can('quiz.create') && <Link className="primary-button" to="/admin/quizzes/new">+ Nový kvíz</Link>}
          <p className="section-count" aria-label="Souhrn knihovny">
            {quizzes.length} {quizzes.length === 1 ? 'kvíz' : quizzes.length < 5 ? 'kvízy' : 'kvízů'}
          </p>
        </div>
      </header>

      {quizzes.length === 0 ? (
        <div className="quiz-state-card">
          <div>
            <h2>Zatím tu nejsou žádné kvízy</h2>
            <p>Jakmile bude kvíz vytvořený, objeví se v této knihovně.</p>
          </div>
          <div className="quiz-empty-actions">
            {can('quiz.create') && <Link className="primary-button" to="/admin/quizzes/new">+ Nový kvíz</Link>}
            <button className="secondary-button" type="button" onClick={() => void loadQuizzes()}>Načíst znovu</button>
          </div>
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
