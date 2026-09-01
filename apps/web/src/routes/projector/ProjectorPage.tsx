import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

import { subscribePublicLiveState } from '../../features/live/liveRepository';
import type { PublicLiveState } from '../../features/live/types';
import { SlidePreview } from '../../features/presentation/SlidePreview';

function ProjectorState({ state }: { readonly state: PublicLiveState }) {
  if (state.status === 'waiting') {
    return (
      <section className="projector-stage projector-message">
        <p className="eyebrow">{state.quizTitle}</p>
        <h1>Čekáme na první slide</h1>
        <p>Moderátor kvíz připravuje.</p>
      </section>
    );
  }

  if (state.status === 'ended') {
    return (
      <section className="projector-stage projector-message">
        <p className="eyebrow">{state.quizTitle}</p>
        <h1>Kvíz skončil</h1>
        <p>Děkujeme za účast.</p>
      </section>
    );
  }

  return (
    <SlidePreview
      quizTitle={state.quizTitle}
      position={state.slidePosition}
      showAnswer={state.answerRevealed}
      slide={{
        kind: state.slideKind ?? 'legacy',
        title: state.title ?? '',
        text: state.text ?? '',
        options: state.options,
        media: [
          ...state.media,
          ...(state.answerImage ? [{ role: 'answer', kind: 'image', source: state.answerImage }] : []),
        ],
        ...(state.revealedAnswer === undefined ? {} : { correctAnswer: state.revealedAnswer }),
      }}
    />
  );
}

export function ProjectorPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const [state, setState] = useState<PublicLiveState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const markOffline = () => {
      setState(null);
      setError('Projektor je offline; z bezpečnostních důvodů nezobrazuje uložený stav.');
      setLoading(false);
    };
    window.addEventListener('offline', markOffline);
    const unsubscribe = subscribePublicLiveState(sessionId, (value) => {
      setState(value);
      setError(null);
      setLoading(false);
    }, () => {
      setState(null);
      setError('Spojení s projektorem se nezdařilo. Zkontrolujte emulator a připojení.');
      setLoading(false);
    });
    return () => {
      window.removeEventListener('offline', markOffline);
      unsubscribe();
    };
  }, [sessionId]);

  if (!sessionId) {
    return <section className="projector-stage projector-message"><h1>Chybí session ID</h1><p>Otevřete odkaz vytvořený v moderátorském panelu.</p></section>;
  }
  if (loading) return <section className="projector-stage projector-message"><h1>Načítám projektor…</h1></section>;
  if (error) return <section className="projector-stage projector-message error"><h1>Projektor není připojen</h1><p>{error}</p></section>;
  if (!state) return <section className="projector-stage projector-message"><h1>Session nenalezena</h1><p>Zkontrolujte adresu projektoru.</p></section>;
  return <ProjectorState state={state} />;
}
