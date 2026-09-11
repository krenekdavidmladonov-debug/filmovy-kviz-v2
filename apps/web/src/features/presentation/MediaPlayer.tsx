import { useEffect, useReducer, useRef, type ComponentProps } from 'react';
import { parseQuizAsset, directMediaKind } from '@filmovy-kviz/quiz-domain';
import { YouTubePlayer } from './YouTubePlayer';
import { initialMediaMachineState, reduceMediaMachine } from './mediaStateMachine';
import { recordPlayerLifecycle } from './performance';
import { readQuizMediaBlob } from '../media/mediaApi';
type PlayerProps = ComponentProps<typeof YouTubePlayer> & { readonly sessionId?: string | undefined };
export function MediaPlayer(props: PlayerProps) {
  return parseQuizAsset(props.source) || directMediaKind(props.source) ? <NativeMediaPlayer {...props} /> : <YouTubePlayer {...props} />;
}
function NativeMediaPlayer({ source, command, generation, startSeconds, endSeconds, className, onFinished, onError, onPlaybackState, currentTimeRequest, onCurrentTime, sessionId }: PlayerProps) {
  const host = useRef<HTMLDivElement>(null), audio = useRef<HTMLMediaElement | null>(null);
  const callbacks = useRef({ onFinished, onError, onPlaybackState, onCurrentTime });
  const [machine, dispatch] = useReducer(reduceMediaMachine, initialMediaMachineState);
  useEffect(() => { callbacks.current = { onFinished, onError, onPlaybackState, onCurrentTime }; }, [onFinished, onError, onPlaybackState, onCurrentTime]);
  useEffect(() => { if (audio.current && currentTimeRequest !== undefined && currentTimeRequest > 0) callbacks.current.onCurrentTime?.(audio.current.currentTime); }, [currentTimeRequest]);
  useEffect(() => {
    const abort = new AbortController(); let active = true, objectUrl: string | undefined, player: HTMLMediaElement | undefined;
    let counted = false, finished = false;
    const debug = (delta: 1 | -1) => {
      const value = window.__FILMOVY_KVIZ_MEDIA_DEBUG__ ?? { activePlayers: 0, peakPlayers: 0, createdPlayers: 0, destroyedPlayers: 0 };
      recordPlayerLifecycle(value, delta); window.__FILMOVY_KVIZ_MEDIA_DEBUG__ = value;
    };
    const fail = () => { if (!active || finished) return; finished = true; player?.pause(); if (player) player.controls = false; dispatch({ type: 'error', generation, message: 'Médium není dostupné nebo časování přesahuje délku souboru.' }); callbacks.current.onError?.(generation, 'Médium není dostupné nebo časování přesahuje délku souboru.'); };
    const finish = () => { if (!active || finished) return; finished = true; player?.pause(); if (player) player.controls = false; dispatch({ type: 'finished', generation }); callbacks.current.onFinished?.(generation); };
    dispatch({ type: command === 'play' || command === 'replay' ? 'play' : 'reset', generation });
    if (command === 'error') { fail(); return () => { active = false; abort.abort(); }; }
    const load = parseQuizAsset(source) ? readQuizMediaBlob(source, abort.signal, sessionId) : Promise.resolve(null);
    const timeout = window.setTimeout(() => { fail(); abort.abort(); }, 15000);
    void load.then(blob => {
      if (!active || finished || abort.signal.aborted || !host.current) return;
      if (blob) objectUrl = URL.createObjectURL(blob); player = document.createElement(directMediaKind(source) === 'video' ? 'video' : 'audio'); audio.current = player;
      player.controls = command === 'play' || command === 'replay'; player.preload = 'metadata'; player.src = objectUrl ?? source; player.setAttribute('aria-label', directMediaKind(source) === 'video' ? 'Video ukázka' : 'Vlastní audio');
      player.onloadedmetadata = () => {
        if (!active || finished || !player) return;
        if (!Number.isFinite(player.duration) || startSeconds >= player.duration || (endSeconds !== undefined && endSeconds > player.duration + 0.1)) { fail(); return; }
        window.clearTimeout(timeout);
        player.currentTime = startSeconds;
        if (command !== 'stop' && command !== 'finished') callbacks.current.onPlaybackState?.(generation, 'ready');
        dispatch({ type: command === 'finished' ? 'finished' : 'ready', generation });
        if (command === 'play' || command === 'replay') { callbacks.current.onPlaybackState?.(generation, 'ready'); void player.play().catch(fail); }
      };
      player.onplaying = () => { if (active && !finished) { dispatch({ type: 'playing', generation }); callbacks.current.onPlaybackState?.(generation, 'playing'); } };
      player.onpause = () => { if (active && !finished && command !== 'stop') { dispatch({ type: 'ready', generation }); callbacks.current.onPlaybackState?.(generation, 'ready'); } };
      player.ontimeupdate = () => { if (active && player && endSeconds !== undefined && player.currentTime >= endSeconds) finish(); };
      player.onended = finish; player.onerror = fail;
      host.current.replaceChildren(player); debug(1); counted = true;
    }).catch(() => { if (!abort.signal.aborted) fail(); });
    return () => {
      active = false; abort.abort(); window.clearTimeout(timeout);
      if (player) { player.pause(); player.removeAttribute('src'); player.load(); player.remove(); if (audio.current === player) audio.current = null; }
      if (objectUrl) URL.revokeObjectURL(objectUrl); if (counted) debug(-1);
    };
  }, [source, command, generation, startSeconds, endSeconds, sessionId]);
  return <div className={className ?? 'youtube-player-shell'} data-media-lifecycle={machine.lifecycle} data-owned-audio={Boolean(parseQuizAsset(source))}><div ref={host} />{machine.lifecycle === 'ERROR' && <p role="status">Médium není dostupné nebo časování přesahuje délku souboru. Použijte Pustit znovu.</p>}</div>;
}
