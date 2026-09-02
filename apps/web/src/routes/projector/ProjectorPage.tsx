import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';

import { productConfig } from '../../config/product';
import {
  broadcastPlaybackState,
  openProjectorChannel,
  parseProjectorChannelMessage,
  shouldAcceptProjectorFastPath,
  type ProjectorChannel,
} from '../../features/live/projectorChannel';
import { subscribePublicLiveState } from '../../features/live/liveRepository';
import { projectorFullscreenFailureMessage, requestProjectorFullscreen } from '../../features/live/projectorWindow';
import type { PublicLiveState } from '../../features/live/types';
import { SlideRenderer } from '../../features/presentation/SlideRenderer';

function ProjectorMessage({ title, text, quizTitle, error = false }: {
  readonly title: string; readonly text?: string; readonly quizTitle?: string; readonly error?: boolean;
}) {
  return (
    <article className={`projector-message-canvas${error ? ' is-error' : ''}`}>
      <div><p className="slide-kicker">{quizTitle ?? productConfig.name}</p><h1>{title}</h1>{text && <p>{text}</p>}</div>
    </article>
  );
}

function ProjectorState({ state, onMediaFinished, onMediaPlaybackState }: {
  readonly state: PublicLiveState;
  readonly onMediaFinished: (generation: number) => void;
  readonly onMediaPlaybackState: (generation: number, state: 'ready' | 'playing' | 'error') => void;
}) {
  if (state.status === 'waiting') return <ProjectorMessage quizTitle={state.quizTitle} title="Čekáme na první slide" text="Moderátor kvíz připravuje." />;
  if (state.status === 'ended') return <ProjectorMessage quizTitle={state.quizTitle} title="Kvíz skončil" text="Děkujeme za účast." />;
  return (
    <SlideRenderer
      quizTitle={state.quizTitle}
      mode={state.renderMode}
      mediaCommand={state.mediaCommand}
      mediaPlaybackState={state.mediaPlaybackState}
      mediaGeneration={state.mediaGeneration}
      introGeneration={state.introGeneration}
      onMediaFinished={onMediaFinished}
      onMediaPlaybackState={(generation, playbackState) => onMediaPlaybackState(generation, playbackState)}
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
  const [fullscreenNotice, setFullscreenNotice] = useState<string | null>(null);
  const stateRef = useRef<PublicLiveState | null>(null);
  const authoritativeStateRef = useRef<PublicLiveState | null>(null);
  const authoritativeRevisionRef = useRef(-1);
  const fastPathRollbackRef = useRef<number | undefined>(undefined);
  const channelRef = useRef<ProjectorChannel | undefined>(undefined);

  useEffect(() => {
    if (!sessionId) { setLoading(false); return; }
    setLoading(true);
    const channel = openProjectorChannel(sessionId);
    channelRef.current = channel;
    if (channel) {
      channel.setMessageHandler((data) => {
        const message = parseProjectorChannelMessage(data);
        if (message?.type !== 'public-state') return;
        const next = message.state;
        if (!shouldAcceptProjectorFastPath(
          sessionId,
          authoritativeRevisionRef.current,
          stateRef.current?.revision ?? -1,
          next,
        )) return;
        if (fastPathRollbackRef.current !== undefined) window.clearTimeout(fastPathRollbackRef.current);
        stateRef.current = next;
        setState(next);
        setError(null);
        setLoading(false);
        fastPathRollbackRef.current = window.setTimeout(() => {
          const authoritative = authoritativeStateRef.current;
          if (authoritative === null || authoritative.revision >= next.revision) return;
          stateRef.current = authoritative;
          setState(authoritative);
          fastPathRollbackRef.current = undefined;
        }, 1_500);
      });
    }
    const markOffline = () => {
      if (fastPathRollbackRef.current !== undefined) window.clearTimeout(fastPathRollbackRef.current);
      fastPathRollbackRef.current = undefined;
      stateRef.current = null;
      authoritativeStateRef.current = null;
      authoritativeRevisionRef.current = -1;
      setState(null);
      setError('Projektor je offline; z bezpečnostních důvodů nezobrazuje uložený stav.');
      setLoading(false);
    };
    window.addEventListener('offline', markOffline);
    const unsubscribe = subscribePublicLiveState(sessionId, (value) => {
      if (fastPathRollbackRef.current !== undefined) window.clearTimeout(fastPathRollbackRef.current);
      fastPathRollbackRef.current = undefined;
      authoritativeStateRef.current = value;
      authoritativeRevisionRef.current = value?.revision ?? -1;
      stateRef.current = value;
      setState(value);
      setError(null);
      setLoading(false);
    }, () => {
      if (fastPathRollbackRef.current !== undefined) window.clearTimeout(fastPathRollbackRef.current);
      fastPathRollbackRef.current = undefined;
      stateRef.current = null;
      authoritativeStateRef.current = null;
      authoritativeRevisionRef.current = -1;
      setState(null);
      setError('Spojení s projektorem se nezdařilo. Zkontrolujte emulator a připojení.');
      setLoading(false);
    });
    return () => {
      window.removeEventListener('offline', markOffline);
      if (fastPathRollbackRef.current !== undefined) window.clearTimeout(fastPathRollbackRef.current);
      unsubscribe();
      channel?.close();
      channelRef.current = undefined;
    };
  }, [sessionId]);

  const enterFullscreen = useCallback(async () => {
    const opened = await requestProjectorFullscreen();
    setFullscreenNotice(opened ? null : projectorFullscreenFailureMessage);
  }, []);

  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === 'f' && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        void enterFullscreen();
      }
    };
    window.addEventListener('keydown', keyboard);
    return () => window.removeEventListener('keydown', keyboard);
  }, [enterFullscreen]);

  let content;
  if (!sessionId) content = <ProjectorMessage title="Chybí session ID" text="Otevřete odkaz vytvořený v moderátorském panelu." />;
  else if (loading) content = <ProjectorMessage title="Načítám projektor…" />;
  else if (error) content = <ProjectorMessage error title="Projektor není připojen" text={error} />;
  else if (!state) content = <ProjectorMessage title="Session nenalezena" text="Zkontrolujte adresu projektoru." />;
  else content = (
    <ProjectorState
      state={state}
      onMediaFinished={(generation) => broadcastPlaybackState(channelRef.current, state.sessionId, generation, 'finished')}
      onMediaPlaybackState={(generation, playbackState) => broadcastPlaybackState(
        channelRef.current, state.sessionId, generation, playbackState,
      )}
    />
  );

  return (
    <main className="projector-shell">
      <div className="projector-viewport">{content}</div>
      {fullscreenNotice && <p className="projector-fullscreen-notice" role="status">{fullscreenNotice}</p>}
      <button className="projector-fullscreen-button" onClick={() => void enterFullscreen()} title="Celá obrazovka (F)">Celá obrazovka · F</button>
    </main>
  );
}
