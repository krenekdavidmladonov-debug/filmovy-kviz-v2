import { useState, type FormEvent } from 'react';
import { FunctionsError } from 'firebase/functions';
import { Link, useNavigate } from 'react-router-dom';

import { useAuth } from '../../auth/AuthProvider';
import { createQuiz } from '../../features/editor/editorApi';
import { HumanError } from '../../ui/HumanError';

const creationRequestStorageKey = 'justkviz.quiz-create-request-id';

function creationRequestId(): string {
  try {
    const stored = window.sessionStorage.getItem(creationRequestStorageKey);
    if (stored !== null && /^[\w-]{1,150}$/u.test(stored)) return stored;
    const generated = crypto.randomUUID();
    window.sessionStorage.setItem(creationRequestStorageKey, generated);
    return generated;
  } catch {
    return crypto.randomUUID();
  }
}

function clearCreationRequestId(requestId: string): void {
  try {
    if (window.sessionStorage.getItem(creationRequestStorageKey) === requestId) {
      window.sessionStorage.removeItem(creationRequestStorageKey);
    }
  } catch {
    // Creation already succeeded; unavailable session storage does not change that result.
  }
}

function creationError(error: unknown): { readonly message: string; readonly technicalCode: string } {
  if (error instanceof FunctionsError) {
    if (error.code === 'functions/invalid-argument') {
      return { message: 'Zkontrolujte název kvízu a zkuste vytvoření znovu.', technicalCode: error.code };
    }
    if (error.code === 'functions/permission-denied') {
      return { message: 'Kvíz může vytvořit pouze administrátor.', technicalCode: error.code };
    }
    if (error.code === 'functions/already-exists') {
      return { message: 'Tento pokus o vytvoření už byl použit s jiným názvem. Vraťte se do knihovny a zkontrolujte vytvořené kvízy.', technicalCode: error.code };
    }
    return { message: 'Kvíz se nepodařilo vytvořit. Zadaný název zůstal zachovaný.', technicalCode: error.code };
  }
  return { message: 'Kvíz se nepodařilo vytvořit. Zadaný název zůstal zachovaný.', technicalCode: 'QUIZ_CREATE_FAILED' };
}

export function QuizCreatePage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<{ readonly message: string; readonly technicalCode: string } | null>(null);
  const [requestId] = useState(creationRequestId);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (pending) return;
    const normalizedTitle = title.trim();
    if (normalizedTitle === '') {
      setError({ message: 'Zadejte název nového kvízu.', technicalCode: 'QUIZ_TITLE_REQUIRED' });
      return;
    }
    setPending(true);
    setError(null);
    try {
      const result = await createQuiz(normalizedTitle, requestId);
      clearCreationRequestId(requestId);
      await navigate(`/admin/quizzes/${encodeURIComponent(result.quizId)}/edit`);
    } catch (createError) {
      setError(creationError(createError));
    } finally {
      setPending(false);
    }
  };

  if (!can('quiz.create')) {
    return (
      <section className="quiz-state-card">
        <div><h2>Pouze pro administrátora</h2><p>Moderátor může kvízy prohlížet, ale nemůže vytvářet nový obsah.</p></div>
        <Link className="secondary-link" to="/admin/quizzes">Zpět na kvízy</Link>
      </section>
    );
  }

  return (
    <section className="event-editor-page quiz-create-page">
      <Link className="back-link" to="/admin/quizzes">← Zpět na kvízy</Link>
      <header className="event-page-heading event-form-heading">
        <h1>Nový kvíz</h1>
        <p className="lead">Začněte názvem. Kolo a první otázku přidáte hned potom v editoru.</p>
      </header>
      {error && <HumanError error={{ title: 'Kvíz nelze vytvořit', ...error }} />}
      <form className="event-form" aria-busy={pending} onSubmit={(event) => void submit(event)}>
        <fieldset className="event-form-section" disabled={pending}>
          <legend>Základní údaje</legend>
          <label className="form-field">
            <span>Název kvízu</span>
            <input required autoFocus maxLength={300} value={title} onChange={(event) => { setTitle(event.target.value); setError(null); }} />
          </label>
        </fieldset>
        <div className="event-form-actions">
          <button className="primary-button" type="submit" disabled={pending || title.trim() === ''}>{pending ? 'Vytvářím…' : 'Vytvořit'}</button>
        </div>
      </form>
    </section>
  );
}
