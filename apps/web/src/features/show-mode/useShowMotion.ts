import { useEffect, useRef, useState } from 'react';
import type { ShowCue } from '@filmovy-kviz/quiz-domain';

export interface ShowMotionObservation { sessionId: string; revision: number; cueId?: string }
/** A cue is an ephemeral presentation hint, never a clock for score/reveal state. */
export function shouldAnimateShowCue(previous: ShowMotionObservation | undefined, next: ShowMotionObservation, cue: ShowCue | undefined, now: number, reducedMotion: boolean): boolean {
  if (!previous || previous.sessionId !== next.sessionId || next.revision <= previous.revision || !cue || previous.cueId === cue.id
    || reducedMotion || cue.motion !== 'animate' || cue.intensity === 'none' || cue.durationMs <= 0
    || now < cue.startedAt || now - cue.startedAt >= cue.durationMs) return false;
  if ((cue.kind === 'third' || cue.kind === 'second') && !cue.topThree) return false;
  if (cue.kind === 'winners' && !cue.winnerAnimation) return false;
  return true;
}

export function useShowMotion(sessionId: string, revision: number, cue?: ShowCue) {
  const previous = useRef<ShowMotionObservation | undefined>(undefined);
  const seen = useRef<{ sessionId: string; ids: Set<string> }>({ sessionId, ids: new Set() });
  const [activeId, setActiveId] = useState<string>();
  const [reducedMotion, setReducedMotion] = useState(() => typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches));
  useEffect(() => {
    const query = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!query) return;
    const changed = () => { setReducedMotion(query.matches); if (query.matches) setActiveId(undefined); };
    query.addEventListener('change', changed);
    return () => query.removeEventListener('change', changed);
  }, []);
  useEffect(() => {
    const observation = { sessionId, revision, cueId: cue?.id };
    if (seen.current.sessionId !== sessionId) seen.current = { sessionId, ids: new Set() };
    const replay = cue !== undefined && seen.current.ids.has(cue.id);
    const animate = !replay && shouldAnimateShowCue(previous.current, observation, cue, Date.now(), reducedMotion);
    if (cue) {
      seen.current.ids.add(cue.id);
      if (seen.current.ids.size > 256) seen.current.ids.delete(seen.current.ids.values().next().value!);
    }
    previous.current = observation;
    if (!animate || !cue) { setActiveId(undefined); return; }
    setActiveId(cue.id);
    const remaining = Math.max(0, cue.startedAt + cue.durationMs - Date.now());
    const timer = window.setTimeout(() => setActiveId(undefined), remaining);
    return () => window.clearTimeout(timer);
  }, [sessionId, revision, cue, reducedMotion]);
  return { animated: activeId !== undefined && activeId === cue?.id && !reducedMotion && cue.motion === 'animate', intensity: cue?.intensity ?? 'none', cueId: cue?.id ?? 'static' };
}
