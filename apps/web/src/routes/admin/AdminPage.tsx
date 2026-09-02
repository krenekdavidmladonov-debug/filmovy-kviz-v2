import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { useAuth } from '../../auth/AuthProvider';
import { formatQuizDate, getQuizDataError, quizStatusLabels } from '../../features/quizzes/presentation';
import { listQuizzes } from '../../features/quizzes/quizRepository';
import type { QuizSummary } from '../../features/quizzes/types';
import { QuizLoading } from '../../features/quizzes/QuizLoading';
import { HumanError } from '../../ui/HumanError';

export function AdminPage() {
  const { role } = useAuth();
  const [quizzes, setQuizzes] = useState<readonly QuizSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
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

  useEffect(() => { void load(); }, [load]);

  if (loading) return <QuizLoading label="Načítám přehled…" />;

  const continueQuiz = quizzes.find((quiz) => quiz.status === 'draft') ?? quizzes[0];
  const recentQuizzes = quizzes.slice(0, 4);

  return (
    <section className="admin-dashboard">
      <header className="section-heading compact-heading">
        <div>
          <p className="eyebrow">Administrace</p>
          <h1>Přehled</h1>
          <p className="lead">Rychlý návrat k práci s vašimi kvízy.</p>
        </div>
        <Link className="secondary-link" to="/admin/quizzes">Zobrazit všechny kvízy</Link>
      </header>

      {error && (
        <HumanError
          error={{ title: 'Přehled se nepodařilo načíst', message: error }}
          onRetry={() => void load()}
        />
      )}

      {!error && quizzes.length === 0 && (
        <section className="dashboard-empty surface-card">
          <p className="eyebrow">Kvízy</p>
          <h2>Zatím tu nejsou žádné kvízy</h2>
          <p>Jakmile bude dostupný první kvíz, najdete ho na tomto přehledu i v knihovně.</p>
          <Link className="secondary-link" to="/admin/quizzes">Otevřít knihovnu</Link>
        </section>
      )}

      {!error && continueQuiz && (
        <div className="dashboard-grid">
          <section className="continue-card surface-card">
            <p className="eyebrow">Pokračovat</p>
            <span className={`quiz-status status-${continueQuiz.status}`}>{quizStatusLabels[continueQuiz.status]}</span>
            <h2>{continueQuiz.title}</h2>
            <p>{continueQuiz.description || 'Kvíz je připravený k další práci.'}</p>
            <p className="card-meta">Naposledy upraveno {formatQuizDate(continueQuiz.updatedAt)}</p>
            <Link
              className="primary-link"
              to={role === 'admin'
                ? `/admin/quizzes/${encodeURIComponent(continueQuiz.id)}/edit`
                : `/admin/quizzes/${encodeURIComponent(continueQuiz.id)}`}
            >
              {role === 'admin' ? 'Pokračovat v úpravách' : 'Otevřít detail'}
            </Link>
          </section>

          <section className="recent-card surface-card" aria-labelledby="recent-quizzes-title">
            <div className="card-heading-row">
              <div>
                <p className="eyebrow">Naposledy změněné</p>
                <h2 id="recent-quizzes-title">Poslední kvízy</h2>
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
