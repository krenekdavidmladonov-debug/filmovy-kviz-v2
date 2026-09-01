import { useEffect, useId, useReducer, useRef, useState } from 'react';

import { initialMediaMachineState, reduceMediaMachine } from './mediaStateMachine';
import { youtubeVideoId } from './model';
import { recordPlayerLifecycle } from './performance';
import type { MediaPlaybackCommand } from './types';

interface YouTubePlayerInstance {
  cueVideoById(options: { videoId: string; startSeconds?: number; endSeconds?: number }): void;
  loadVideoById(options: { videoId: string; startSeconds?: number; endSeconds?: number }): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  destroy(): void;
}

interface YouTubeNamespace {
  Player: new (
    element: HTMLElement,
    options: {
      videoId: string;
      playerVars: Record<string, number | string>;
      events: {
        onReady: () => void;
        onStateChange: (event: { data: number }) => void;
        onError: () => void;
        onAutoplayBlocked?: () => void;
      };
    },
  ) => YouTubePlayerInstance;
  PlayerState: { readonly ENDED: number; readonly PLAYING: number };
}

declare global {
  interface Window {
    YT?: YouTubeNamespace;
    onYouTubeIframeAPIReady?: () => void;
    __FILMOVY_KVIZ_MEDIA_DEBUG__?: {
      activePlayers: number;
      peakPlayers: number;
      createdPlayers: number;
      destroyedPlayers: number;
    };
  }
}

let apiPromise: Promise<YouTubeNamespace> | undefined;

function mediaDebug(delta: 1 | -1): void {
  const current = window.__FILMOVY_KVIZ_MEDIA_DEBUG__ ?? {
    activePlayers: 0,
    peakPlayers: 0,
    createdPlayers: 0,
    destroyedPlayers: 0,
  };
  recordPlayerLifecycle(current, delta);
  window.__FILMOVY_KVIZ_MEDIA_DEBUG__ = current;
}

function loadYouTubeApi(): Promise<YouTubeNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (apiPromise !== undefined) return apiPromise;
  apiPromise = new Promise((resolve, reject) => {
    const prior = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prior?.();
      if (window.YT?.Player) resolve(window.YT);
      else reject(new Error('YouTube API is unavailable.'));
    };
    const existing = document.querySelector<HTMLScriptElement>('script[data-filmovy-kviz-youtube-api]');
    if (existing) return;
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.async = true;
    script.dataset.filmovyKvizYoutubeApi = 'true';
    script.onerror = () => reject(new Error('YouTube API could not be loaded.'));
    document.head.append(script);
  });
  return apiPromise;
}

export function YouTubePlayer({
  source,
  command,
  generation,
  startSeconds,
  endSeconds,
  className,
  onFinished,
  onError,
}: {
  readonly source: string;
  readonly command: MediaPlaybackCommand;
  readonly generation: number;
  readonly startSeconds: number;
  readonly endSeconds?: number;
  readonly className?: string;
  readonly onFinished?: (generation: number) => void;
  readonly onError?: (message: string) => void;
}) {
  const reactId = useId();
  const hostRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YouTubePlayerInstance | undefined>(undefined);
  const readyRef = useRef(false);
  const commandRef = useRef({ command, generation, startSeconds, endSeconds });
  const onFinishedRef = useRef(onFinished);
  const onErrorRef = useRef(onError);
  const [machine, dispatch] = useReducer(reduceMediaMachine, initialMediaMachineState);
  const [visibleError, setVisibleError] = useState<string>();
  const videoId = youtubeVideoId(source);

  useEffect(() => { onFinishedRef.current = onFinished; }, [onFinished]);
  useEffect(() => { onErrorRef.current = onError; }, [onError]);

  useEffect(() => {
    commandRef.current = { command, generation, startSeconds, endSeconds };
    const player = playerRef.current;
    if (!readyRef.current || player === undefined) return;
    if (command === 'play' || command === 'replay') {
      dispatch({ type: 'play', generation });
      player.loadVideoById({ videoId: videoId ?? '', startSeconds, ...(endSeconds === undefined ? {} : { endSeconds }) });
    } else if (command === 'stop' || command === 'finished') {
      dispatch({ type: command === 'stop' ? 'stop' : 'finished', generation });
      player.pauseVideo();
      player.seekTo(startSeconds, true);
    } else if (command === 'idle') {
      dispatch({ type: 'reset', generation });
      player.pauseVideo();
      player.seekTo(startSeconds, true);
    }
  }, [command, endSeconds, generation, startSeconds, videoId]);

  useEffect(() => {
    let cancelled = false;
    if (videoId === undefined || hostRef.current === null) {
      setVisibleError('Zdroj není podporovaný YouTube odkaz ani video ID.');
      return;
    }
    dispatch({ type: 'prepare', generation: commandRef.current.generation });
    void loadYouTubeApi().then((YT) => {
      if (cancelled || hostRef.current === null) return;
      const player = new YT.Player(hostRef.current, {
        videoId,
        playerVars: { controls: 1, rel: 0, playsinline: 1, origin: window.location.origin },
        events: {
          onReady: () => {
            if (cancelled) return;
            readyRef.current = true;
            const latest = commandRef.current;
            player.cueVideoById({
              videoId,
              startSeconds: latest.startSeconds,
              ...(latest.endSeconds === undefined ? {} : { endSeconds: latest.endSeconds }),
            });
            dispatch({ type: 'ready', generation: latest.generation });
            if (latest.command === 'play' || latest.command === 'replay') {
              player.loadVideoById({
                videoId,
                startSeconds: latest.startSeconds,
                ...(latest.endSeconds === undefined ? {} : { endSeconds: latest.endSeconds }),
              });
            }
          },
          onStateChange: (event) => {
            const latest = commandRef.current;
            if (event.data === YT.PlayerState.PLAYING) dispatch({ type: 'playing', generation: latest.generation });
            if (event.data === YT.PlayerState.ENDED) {
              dispatch({ type: 'finished', generation: latest.generation });
              onFinishedRef.current?.(latest.generation);
            }
          },
          onError: () => {
            const message = 'YouTube médium se nepodařilo přehrát.';
            const latest = commandRef.current;
            dispatch({ type: 'error', generation: latest.generation, message });
            setVisibleError(message);
            onErrorRef.current?.(message);
          },
          onAutoplayBlocked: () => {
            const message = 'Prohlížeč zablokoval přehrání. Spusťte médium znovu ručně.';
            setVisibleError(message);
            onErrorRef.current?.(message);
          },
        },
      });
      playerRef.current = player;
      mediaDebug(1);
    }).catch(() => {
      if (cancelled) return;
      const message = 'YouTube přehrávač se nepodařilo načíst.';
      setVisibleError(message);
      onErrorRef.current?.(message);
    });
    return () => {
      cancelled = true;
      readyRef.current = false;
      if (playerRef.current !== undefined) {
        playerRef.current.destroy();
        playerRef.current = undefined;
        mediaDebug(-1);
      }
    };
  }, [videoId]);

  return (
    <div className={className ?? 'youtube-player-shell'} data-media-lifecycle={machine.lifecycle} data-player-id={reactId}>
      <div ref={hostRef} className="youtube-player-host" />
      {visibleError && <p className="projector-media-error" role="status">Médium není dostupné. Moderátor může pokračovat textovou otázkou.</p>}
    </div>
  );
}
