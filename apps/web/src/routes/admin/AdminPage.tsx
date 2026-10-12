import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { useAuth } from '../../auth/AuthProvider';
import { formatQuizDate, getQuizDataError, quizStatusLabels } from '../../features/quizzes/presentation';
import { listQuizzes } from '../../features/quizzes/quizRepository';
import type { QuizSummary } from '../../features/quizzes/types';
import { QuizLoading } from '../../features/quizzes/QuizLoading';
import { HumanError } from '../../ui/HumanError';

export function AdminPage() {
  const { can } = useAuth();
  const [quizzes, setQuizzes] = useState<readonly QuizSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setQuizzes(can('quiz.read') ? await listQuizzes() : []);
    } catch (loadError) {
      setError(getQuizDataError(loadError));
    } finally {
      setLoading(false);
    }
  }, [can]);

  useEffect(() => { void load(); }, [load]);

  if (loading) return <QuizLoading label="Načítám přehled…" />;

  const continueQuiz = quizzes.find((quiz) => quiz.status === 'draft') ?? quizzes[0];
  const recentQuizzes = quizzes.slice(0, 4);

  return (
    <section className="admin-dashboard">
      <header className="dashboard-heading">
        <h1>Přehled</h1>
        {(can('quiz.read') || can('event.read')) && (
          <nav className="dashboard-actions" aria-label="Akce přehledu">
            {can('quiz.create') && <Link className="primary-link" to="/admin/quizzes/new">Nový kvíz</Link>}
            {can('event.create') && <Link className="secondary-link" to="/admin/events/new">Vytvořit akci</Link>}
            {can('quiz.read') && <Link className="secondary-link" to="/admin/quizzes">Kvízy</Link>}
            {can('event.read') && <Link className="secondary-link" to="/admin/events">Akce</Link>}
          </nav>
        )}
      </header>

      {error && (
        <HumanError
          error={{ title: 'Přehled se nepodařilo načíst', message: error }}
          onRetry={() => void load()}
        />
      )}

      {!can('quiz.read') && <p>Rozsah svého přístupu najdete v <Link to="/account">osobním účtu</Link>.</p>}
      {!error && can('quiz.read') && quizzes.length === 0 && (
        <section className="dashboard-empty surface-card">
          <p className="eyebrow">Kvízy</p>
          <h2>Zatím tu nejsou žádné kvízy</h2>
          <p>{can('quiz.create')
            ? 'Začněte tlačítkem Nový kvíz. Vytvořený kvíz pak najdete i zde.'
            : 'Požádejte správce o přístup ke kvízu. Přidělené kvízy se zobrazí i zde.'}</p>
        </section>
      )}

      {!error && continueQuiz && (
        <div className="dashboard-grid">
          <section className="continue-card surface-card">
            <p className="eyebrow">Pokračovat</p>
            <span className={`quiz-status status-${continueQuiz.status}`}>{quizStatusLabels[continueQuiz.status]}</span>
            <h2>{continueQuiz.title}</h2>
            {continueQuiz.description && <p>{continueQuiz.description}</p>}
            <p className="card-meta">Naposledy upraveno {formatQuizDate(continueQuiz.updatedAt)}</p>
            <Link
              className="primary-link"
              to={can('quiz.edit')
                ? `/admin/quizzes/${encodeURIComponent(continueQuiz.id)}/edit`
                : `/admin/quizzes/${encodeURIComponent(continueQuiz.id)}`}
            >
              {can('quiz.edit') ? 'Pokračovat v úpravách' : 'Otevřít detail'}
            </Link>
          </section>

          <section className="recent-card surface-card" aria-labelledby="recent-quizzes-title">
            <div className="card-heading-row">
              <div>
                <h2 id="recent-quizzes-title">Poslední kvízy</h2>
                <p className="card-meta">Podle poslední úpravy</p>
              </div>
            </div>
            <ul className="recent-quiz-list">
              {recentQuizzes.map((quiz) => (
                <li key={quiz.id}>
                  <Link to={`/admin/quizzes/${encodeURIComponent(quiz.id)}`}>
                    <span><strong>{quiz.title}</strong><small>{quizStatusLabels[quiz.status]}</small></span>
                    <time dateTime={quiz.updatedAt.toISOString()}>{formatQuizDate(quiz.updatedAt)}</time>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </section>
  );
}
