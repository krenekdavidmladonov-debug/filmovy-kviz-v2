import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';

import { broadcastPlaybackFinished, isProjectorChannelMessage, openProjectorChannel, type ProjectorChannel } from '../../features/live/projectorChannel';
import { subscribePublicLiveState } from '../../features/live/liveRepository';
import { requestProjectorFullscreen } from '../../features/live/projectorWindow';
import type { PublicLiveState } from '../../features/live/types';
import { SlideRenderer } from '../../features/presentation/SlideRenderer';

function ProjectorMessage({ title, text, quizTitle, error = false }: {
  readonly title: string; readonly text?: string; readonly quizTitle?: string; readonly error?: boolean;
}) {
  return (
    <article className={`projector-message-canvas${error ? ' is-error' : ''}`}>
      <div><p className="slide-kicker">{quizTitle ?? 'FILMOVÝ KVÍZ'}</p><h1>{title}</h1>{text && <p>{text}</p>}</div>
    </article>
  );
}

function ProjectorState({ state, onMediaFinished }: {
  readonly state: PublicLiveState;
  readonly onMediaFinished: (generation: number) => void;
}) {
  if (state.status === 'waiting') return <ProjectorMessage quizTitle={state.quizTitle} title="Čekáme na první slide" text="Moderátor kvíz připravuje." />;
  if (state.status === 'ended') return <ProjectorMessage quizTitle={state.quizTitle} title="Kvíz skončil" text="Děkujeme za účast." />;
  return (
    <SlideRenderer
      quizTitle={state.quizTitle}
      mode={state.renderMode}
      mediaCommand={state.mediaCommand}
      mediaGeneration={state.mediaGeneration}
      introGeneration={state.introGeneration}
      onMediaFinished={onMediaFinished}
      slide={{
        kind: state.slideKind ?? 'legacy', title: state.title ?? '', text: state.text ?? '',
        options: state.options, media: state.media, presentation: state.presentation,
        ...(state.questionNumber === undefined ? {} : { questionNumber: state.questionNumber }),
        ...(state.questionCount === undefined ? {} : { questionCount: state.questionCount }),
        ...(state.backgroundImage === undefined ? {} : { backgroundImage: state.backgroundImage }),
        ...(state.questionImage === undefined ? {} : { questionImage: state.questionImage }),
        ...(state.answerImage === undefined ? {} : { answerImage: state.answerImage }),
        ...(state.mediaSource === undefined ? {} : { mediaSource: state.mediaSource }),
        ...(state.backgroundOverlay === undefined ? {} : { backgroundOverlay: state.backgroundOverlay }),
        ...(state.clipStartSeconds === undefined ? {} : { clipStartSeconds: state.clipStartSeconds }),
        ...(state.clipEndSeconds === undefined ? {} : { clipEndSeconds: state.clipEndSeconds }),
        ...(state.revealedAnswer === undefined ? {} : { revealedAnswer: state.revealedAnswer }),
      }}
    />
  );
}

export function ProjectorPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const [state, setState] = useState<PublicLiveState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const stateRef = useRef<PublicLiveState | null>(null);
  const channelRef = useRef<ProjectorChannel | undefined>(undefined);

  useEffect(() => {
    if (!sessionId) { setLoading(false); return; }
    setLoading(true);
    const channel = openProjectorChannel(sessionId);
    channelRef.current = channel;
    if (channel) {
      channel.setMessageHandler((data) => {
        if (!isProjectorChannelMessage(data) || data.type !== 'public-state') return;
        const next = data.state;
        if (next.sessionId !== sessionId || next.revision < (stateRef.current?.revision ?? -1)) return;
        stateRef.current = next;
        setState(next);
        setError(null);
        setLoading(false);
      });
    }
    const markOffline = () => {
      stateRef.current = null;
      setState(null);
      setError('Projektor je offline; z bezpečnostních důvodů nezobrazuje uložený stav.');
      setLoading(false);
    };
    window.addEventListener('offline', markOffline);
    const unsubscribe = subscribePublicLiveState(sessionId, (value) => {
      stateRef.current = value;
      setState(value);
      setError(null);
      setLoading(false);
    }, () => {
      stateRef.current = null;
      setState(null);
      setError('Spojení s projektorem se nezdařilo. Zkontrolujte emulator a připojení.');
      setLoading(false);
    });
    return () => {
      window.removeEventListener('offline', markOffline);
      unsubscribe();
      channel?.close();
      channelRef.current = undefined;
    };
  }, [sessionId]);

  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === 'f' && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        void requestProjectorFullscreen();
      }
    };
    window.addEventListener('keydown', keyboard);
    return () => window.removeEventListener('keydown', keyboard);
  }, []);

  let content;
  if (!sessionId) content = <ProjectorMessage title="Chybí session ID" text="Otevřete odkaz vytvořený v moderátorském panelu." />;
  else if (loading) content = <ProjectorMessage title="Načítám projektor…" />;
  else if (error) content = <ProjectorMessage error title="Projektor není připojen" text={error} />;
  else if (!state) content = <ProjectorMessage title="Session nenalezena" text="Zkontrolujte adresu projektoru." />;
  else content = <ProjectorState state={state} onMediaFinished={(generation) => broadcastPlaybackFinished(channelRef.current, state.sessionId, generation)} />;

  return (
    <main className="projector-shell">
      <div className="projector-viewport">{content}</div>
      <button className="projector-fullscreen-button" onClick={() => void requestProjectorFullscreen()} title="Celá obrazovka (F)">Celá obrazovka · F</button>
    </main>
  );
}
