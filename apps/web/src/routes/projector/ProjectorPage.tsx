import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

import { subscribePublicLiveState } from '../../features/live/liveRepository';
import type { PublicLiveState, PublicMedia } from '../../features/live/types';

function safeHttpUrl(value: string): string | undefined {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.toString() : undefined;
  } catch {
    return undefined;
  }
}

function MediaItem({ media }: { readonly media: PublicMedia }) {
  const url = safeHttpUrl(media.source);
  if (media.kind === 'image' && url) {
    return <img className="projector-image" src={url} alt="Médium k otázce" />;
  }
  return (
    <div className={`projector-media media-${media.kind}`}>
      <strong>{media.kind === 'audio' ? 'Audio' : media.kind === 'video' ? 'Video' : 'Médium'}</strong>
      {url ? <a href={url} target="_blank" rel="noreferrer">Otevřít bezpečný zdroj</a> : <span>{media.source}</span>}
    </div>
  );
}

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

  const isLegacy = state.slideKind === 'pl' || state.slideKind === 'legacy';
  return (
    <article className="projector-stage">
      <header className="projector-meta">
        <span>Slide {state.slidePosition}</span>
        <span>{isLegacy ? 'Legacy slide' : state.slideKind}</span>
      </header>
      <p className="eyebrow">{state.quizTitle}</p>
      <h1>{state.title || (isLegacy ? 'Legacy slide' : 'Filmový kvíz')}</h1>
      {state.text && <p className="projector-prompt">{state.text}</p>}
      {state.options.length > 0 && (
        <ol className="projector-options">
          {state.options.map((option, index) => <li key={`${index}-${option}`}>{option}</li>)}
        </ol>
      )}
      {state.media.length > 0 && (
        <div className="projector-media-grid">
          {state.media.map((media, index) => <MediaItem key={`${media.role}-${media.source}-${index}`} media={media} />)}
        </div>
      )}
      {state.answerRevealed && (
        <section className="projector-answer" aria-live="polite">
          <span>Správná odpověď</span>
          <strong>{state.revealedAnswer}</strong>
          {state.answerImage && safeHttpUrl(state.answerImage) && (
            <img className="projector-image answer" src={state.answerImage} alt="Obrázek k odhalené odpovědi" />
          )}
        </section>
      )}
    </article>
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
