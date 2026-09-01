import { FirebaseError } from 'firebase/app';
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import {
  endLiveSession,
  hideAnswer,
  nextSlide,
  previousSlide,
  revealAnswer,
} from '../../features/live/liveApi';
import { subscribeLiveControl, subscribeLiveControlSlide } from '../../features/live/liveRepository';
import type { LiveControlSlide, LiveControlState } from '../../features/live/types';
import { QuizLoading } from '../../features/quizzes/QuizLoading';

function operationError(error: unknown): string {
  if (error instanceof FirebaseError && error.code === 'functions/aborted') {
    return 'Session mezitím změnil jiný panel. Aktuální stav byl obnoven; akci zopakujte.';
  }
  if (error instanceof FirebaseError && error.code === 'functions/failed-precondition') {
    return error.message || 'Akci v aktuálním stavu nelze provést.';
  }
  return 'Live operace se nezdařila. Zkontrolujte připojení k Functions Emulatoru.';
}

export function LiveControlPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const [session, setSession] = useState<LiveControlState | null>(null);
  const [slide, setSlide] = useState<LiveControlSlide | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) {
      setLoading(false);
      return;
    }
    return subscribeLiveControl(sessionId, (value) => {
      setSession(value);
      setLoading(false);
    }, () => {
      setError('Privátní live session se nepodařilo načíst.');
      setLoading(false);
    });
  }, [sessionId]);

  useEffect(() => {
    setSlide(null);
    if (!session?.currentSlideId) return;
    return subscribeLiveControlSlide(session.quizId, session.currentSlideId, setSlide, () => {
      setError('Aktuální privátní slide se nepodařilo načíst.');
    });
  }, [session?.currentSlideId, session?.quizId]);

  const projectorUrl = useMemo(() => (
    sessionId ? `${window.location.origin}/projector/${encodeURIComponent(sessionId)}` : ''
  ), [sessionId]);

  async function run(action: (id: string, revision: number) => Promise<unknown>) {
    if (!sessionId || !session) return;
    setPending(true);
    setError(null);
    try {
      await action(sessionId, session.revision);
    } catch (actionError) {
      setError(operationError(actionError));
    } finally {
      setPending(false);
    }
  }

  if (loading) return <QuizLoading label="Načítám live session…" />;
  if (!sessionId || !session) {
    return <section className="quiz-state-card"><div><h1>Live session nenalezena</h1><p>Vraťte se do knihovny a spusťte kvíz znovu.</p></div><Link to="/admin/quizzes">Knihovna</Link></section>;
  }

  const ended = session.status === 'ended';
  const legacy = slide?.kind === 'pl' || slide?.kind === 'legacy';
  return (
    <article className="live-control">
      <header className="live-heading">
        <div>
          <p className="eyebrow">Moderátorský live control</p>
          <h1>{session.quizTitle}</h1>
          <p className="lead">Stav: {session.status} · revize {session.revision}</p>
        </div>
        <a className="secondary-link" href={projectorUrl} target="_blank" rel="noreferrer">Otevřít projektor ↗</a>
      </header>

      {error && <p className="form-error" role="alert">{error}</p>}

      <section className="live-grid">
        <div className="live-preview">
          <div className="live-slide-meta">
            <span>{session.currentSlidePosition || '—'} / {session.slideCount}</span>
            <span>{legacy ? 'Legacy slide' : slide?.kind ?? 'Čekání'}</span>
          </div>
          {session.status === 'waiting' ? (
            <div><h2>Projektor čeká</h2><p>Stiskněte Další pro zobrazení prvního slidu.</p></div>
          ) : ended ? (
            <div><h2>Kvíz byl ukončen</h2><p>Veřejný projektor zobrazuje pouze koncový stav.</p></div>
          ) : slide ? (
            <div>
              <h2>{slide.title || (legacy ? 'Legacy slide' : `Slide ${slide.position}`)}</h2>
              <p>{slide.text}</p>
              {slide.options.length > 0 && <ol>{slide.options.map((option, index) => <li key={`${index}-${option}`}>{option}</li>)}</ol>}
              {slide.isQuestion && (
                <div className="moderator-answer">
                  <span>Privátní odpověď pro moderátora</span>
                  <strong>{slide.correctAnswer ?? 'Odpověď není textově dostupná'}</strong>
                </div>
              )}
            </div>
          ) : <QuizLoading label="Načítám slide…" />}
        </div>

        <aside className="live-actions">
          <a className="projector-url" href={projectorUrl} target="_blank" rel="noreferrer">{projectorUrl}</a>
          <div className="live-button-row">
            <button className="secondary-button" disabled={pending || ended || session.currentSlidePosition <= 1} onClick={() => void run(previousSlide)}>← Předchozí</button>
            <button className="primary-button" disabled={pending || ended || session.currentSlidePosition >= session.slideCount} onClick={() => void run(nextSlide)}>Další →</button>
          </div>
          {session.answerRevealed ? (
            <button className="secondary-button" disabled={pending || ended} onClick={() => void run(hideAnswer)}>Skrýt odpověď</button>
          ) : (
            <button className="secondary-button" disabled={pending || ended || !slide?.isQuestion || !slide.correctAnswer} onClick={() => void run(revealAnswer)}>Odhalit odpověď</button>
          )}
          <button className="danger-button" disabled={pending || ended} onClick={() => void run(endLiveSession)}>Ukončit kvíz</button>
        </aside>
      </section>
    </article>
  );
}
