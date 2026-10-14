import { useEffect, useId, useReducer, useRef, useState } from 'react';

import { initialMediaMachineState, reduceMediaMachine } from './mediaStateMachine';
import { youtubeVideoId } from './model';
import { recordPlayerLifecycle } from './performance';
import type { MediaPlaybackCommand, MediaPlaybackState } from './types';

interface YouTubePlayerInstance {
  cueVideoById(options: { videoId: string; startSeconds?: number; endSeconds?: number }): void;
  loadVideoById(options: { videoId: string; startSeconds?: number; endSeconds?: number }): void;
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
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
  const pending = new Promise<YouTubeNamespace>((resolve, reject) => {
    const prior = window.onYouTubeIframeAPIReady;
    const staleScript = document.querySelector<HTMLScriptElement>('script[data-filmovy-kviz-youtube-api]');
    staleScript?.remove();
    const script = document.createElement('script');
    const fail = (error: Error) => {
      script.remove();
      reject(error);
    };
    window.onYouTubeIframeAPIReady = () => {
      prior?.();
      if (window.YT?.Player) resolve(window.YT);
      else fail(new Error('YouTube API is unavailable.'));
    };
    script.src = 'https://www.youtube.com/iframe_api';
    script.async = true;
    script.dataset.filmovyKvizYoutubeApi = 'true';
    script.onerror = () => fail(new Error('YouTube API could not be loaded.'));
    document.head.append(script);
  });
  const retryable = pending.catch((error: unknown) => {
    if (apiPromise === retryable) apiPromise = undefined;
    throw error;
  });
  apiPromise = retryable;
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
  onPlaybackState,
  currentTimeRequest,
  onCurrentTime,
  allowManualAutoplay = false,
}: {
  readonly source: string;
  readonly command: MediaPlaybackCommand;
  readonly generation: number;
  readonly startSeconds: number;
  readonly endSeconds?: number;
  readonly className?: string;
  readonly onFinished?: (generation: number) => void;
  readonly onError?: (generation: number, message: string) => void;
  readonly onPlaybackState?: (generation: number, state: Extract<MediaPlaybackState, 'ready' | 'playing'>) => void;
  readonly currentTimeRequest?: number;
  readonly onCurrentTime?: (seconds: number) => void;
  readonly allowManualAutoplay?: boolean;
}) {
  const reactId = useId();
  const hostRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YouTubePlayerInstance | undefined>(undefined);
  const epochSequenceRef = useRef(0);
  const activeEpochRef = useRef<number | undefined>(undefined);
  const onFinishedRef = useRef(onFinished);
  const onErrorRef = useRef(onError);
  const onPlaybackStateRef = useRef(onPlaybackState);
  const onCurrentTimeRef = useRef(onCurrentTime);
  const [machine, dispatch] = useReducer(reduceMediaMachine, initialMediaMachineState);
  const [visibleError, setVisibleError] = useState<string>();
  const [blockedEpoch, setBlockedEpoch] = useState<number>();
  const videoId = youtubeVideoId(source);

  useEffect(() => { onFinishedRef.current = onFinished; }, [onFinished]);
  useEffect(() => { onErrorRef.current = onError; }, [onError]);
  useEffect(() => { onPlaybackStateRef.current = onPlaybackState; }, [onPlaybackState]);
  useEffect(() => { onCurrentTimeRef.current = onCurrentTime; }, [onCurrentTime]);
  useEffect(() => {
    if (currentTimeRequest === undefined || currentTimeRequest <= 0 || playerRef.current === undefined) return;
    try {
      const seconds = playerRef.current.getCurrentTime();
      if (Number.isFinite(seconds) && seconds >= 0) onCurrentTimeRef.current?.(seconds);
    } catch {
      // The iframe API can briefly reject reads while a newly mounted player is still preparing.
    }
  }, [currentTimeRequest]);

  useEffect(() => {
    const epoch = epochSequenceRef.current + 1;
    epochSequenceRef.current = epoch;
    activeEpochRef.current = epoch;
    let cancelled = false;
    let mountedPlayer: YouTubePlayerInstance | undefined;
    const active = () => !cancelled && activeEpochRef.current === epoch;
    setVisibleError(undefined);
    setBlockedEpoch(undefined);
    hostRef.current?.replaceChildren();
    if (videoId === undefined || hostRef.current === null) {
      const message = 'Zdroj není podporovaný YouTube odkaz ani video ID.';
      dispatch({ type: 'error', generation, message });
      setVisibleError(message);
      onErrorRef.current?.(generation, message);
      return () => { cancelled = true; if (activeEpochRef.current === epoch) activeEpochRef.current = undefined; };
    }
    if (command === 'error') {
      const message = 'Médium je ve stavu chyby. Použijte REPLAY pro nový pokus.';
      dispatch({ type: 'error', generation, message });
      setVisibleError(message);
      return () => { cancelled = true; if (activeEpochRef.current === epoch) activeEpochRef.current = undefined; };
    }
    if (command === 'play' || command === 'replay') dispatch({ type: 'play', generation });
    else if (command === 'stop') dispatch({ type: 'stop', generation });
    else if (command === 'finished') dispatch({ type: 'finished', generation });
    else dispatch({ type: 'reset', generation });
    void loadYouTubeApi().then((YT) => {
      if (!active() || hostRef.current === null) return;
      const mountPoint = document.createElement('div');
      hostRef.current.append(mountPoint);
      const player = new YT.Player(mountPoint, {
        videoId,
        playerVars: { controls: 1, rel: 0, playsinline: 1, origin: window.location.origin },
        events: {
          onReady: () => {
            if (!active()) return;
            setVisibleError(undefined);
            if (command === 'play' || command === 'replay') {
              dispatch({ type: 'ready', generation });
              onPlaybackStateRef.current?.(generation, 'ready');
              player.loadVideoById({
                videoId,
                startSeconds,
                ...(endSeconds === undefined ? {} : { endSeconds }),
              });
            } else {
              player.cueVideoById({ videoId, startSeconds, ...(endSeconds === undefined ? {} : { endSeconds }) });
              if (command === 'stop') dispatch({ type: 'stop', generation });
              else if (command === 'finished') dispatch({ type: 'finished', generation });
              else dispatch({ type: 'ready', generation });
            }
          },
          onStateChange: (event) => {
            if (!active()) return;
            if (event.data === YT.PlayerState.PLAYING) {
              setVisibleError(undefined);
              setBlockedEpoch(undefined);
              dispatch({ type: 'playing', generation });
              onPlaybackStateRef.current?.(generation, 'playing');
            }
            if (event.data === YT.PlayerState.ENDED) {
              dispatch({ type: 'finished', generation });
              onFinishedRef.current?.(generation);
            }
          },
          onError: () => {
            if (!active()) return;
            setBlockedEpoch(undefined);
            const message = 'YouTube médium se nepodařilo přehrát.';
            dispatch({ type: 'error', generation, message });
            setVisibleError(message);
            onErrorRef.current?.(generation, message);
          },
          onAutoplayBlocked: () => {
            if (!active()) return;
            const message = 'Prohlížeč zablokoval automatické přehrání. Spusťte video ručně na tomto zařízení.';
            if (!allowManualAutoplay) {
              dispatch({ type: 'error', generation, message });
              setVisibleError(message);
              onErrorRef.current?.(generation, message);
              return;
            }
            dispatch({ type: 'ready', generation });
            onPlaybackStateRef.current?.(generation, 'ready');
            setBlockedEpoch(epoch);
            setVisibleError(message);
          },
        },
      });
      mountedPlayer = player;
      playerRef.current = player;
      mediaDebug(1);
    }).catch(() => {
      if (!active()) return;
      const message = 'YouTube přehrávač se nepodařilo načíst.';
      dispatch({ type: 'error', generation, message });
      setVisibleError(message);
      onErrorRef.current?.(generation, message);
    });
    return () => {
      cancelled = true;
      if (activeEpochRef.current === epoch) activeEpochRef.current = undefined;
      if (mountedPlayer !== undefined) {
        mountedPlayer.destroy();
        if (playerRef.current === mountedPlayer) playerRef.current = undefined;
        mediaDebug(-1);
      }
      hostRef.current?.replaceChildren();
    };
  }, [allowManualAutoplay, command, endSeconds, generation, startSeconds, videoId]);

  return (
    <div className={className ?? 'youtube-player-shell'} data-media-lifecycle={machine.lifecycle} data-player-id={reactId}>
      <div ref={hostRef} className="youtube-player-host" />
      {visibleError && <p className="projector-media-error" role="status">{visibleError}</p>}
      {blockedEpoch !== undefined && (command === 'play' || command === 'replay') && <button type="button" className="secondary-button" onClick={() => {
        if (activeEpochRef.current !== blockedEpoch) return;
        try { playerRef.current?.playVideo(); }
        catch { setVisibleError('Video se nepodařilo spustit. Zkuste ovládání přehrávače nebo pokračujte otázkou.'); }
      }}>Spustit video ručně</button>}
    </div>
  );
}
