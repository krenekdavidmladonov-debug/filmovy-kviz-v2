import { parseQuizAsset } from './media-assets.js';
import { normalizeSlideDesign, safeDesignImage, type SlideDesign } from './design.js';

export const showAudioCues = ['intro', 'interim', 'suspense', 'reveal', 'winner'] as const;
export type ShowAudioCue = typeof showAudioCues[number];
export interface ShowPreferences {
  schemaVersion: 1;
  motion: 'none' | 'subtle' | 'show';
  lowerRanks: 'step' | 'bulk';
  topThree: boolean;
  winnerAnimation: boolean;
  audioEnabled: boolean;
  volume: number;
  fadeInMs: number;
  fadeOutMs: number;
  cues: Partial<Record<ShowAudioCue, string>>;
}
export const defaultShowPreferences: Readonly<ShowPreferences> = Object.freeze({
  schemaVersion: 1, motion: 'subtle', lowerRanks: 'step', topThree: true,
  winnerAnimation: true, audioEnabled: false, volume: .25, fadeInMs: 300,
  fadeOutMs: 500, cues: Object.freeze({}),
});
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid show object.');
  return value as Record<string, unknown>;
}
function exact(data: Record<string, unknown>, keys: readonly string[]) {
  if (Object.keys(data).some(k => !keys.includes(k))) throw new Error('Unexpected show field.');
}
const integer = (value: unknown, maximum = Number.MAX_SAFE_INTEGER): value is number => Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= maximum;
/** Missing stored preferences use safe defaults; explicit configuration is a complete strict object. */
export function normalizeShowPreferences(value: unknown): ShowPreferences {
  if (value === undefined) return { ...defaultShowPreferences, cues: {} };
  const d = object(value);
  exact(d, ['schemaVersion', 'motion', 'lowerRanks', 'topThree', 'winnerAnimation', 'audioEnabled', 'volume', 'fadeInMs', 'fadeOutMs', 'cues']);
  if (d.schemaVersion !== 1 || !['none', 'subtle', 'show'].includes(String(d.motion)) || !['step', 'bulk'].includes(String(d.lowerRanks))
    || typeof d.topThree !== 'boolean' || typeof d.winnerAnimation !== 'boolean' || typeof d.audioEnabled !== 'boolean'
    || typeof d.volume !== 'number' || !Number.isFinite(d.volume) || d.volume < 0 || d.volume > 1
    || !integer(d.fadeInMs, 2000) || !integer(d.fadeOutMs, 2000)) throw new Error('Invalid show preferences.');
  const cues = object(d.cues); exact(cues, showAudioCues);
  for (const reference of Object.values(cues)) if (!parseQuizAsset(reference)) throw new Error('Invalid show audio reference.');
  return { schemaVersion: 1, motion: d.motion as ShowPreferences['motion'], lowerRanks: d.lowerRanks as ShowPreferences['lowerRanks'],
    topThree: d.topThree, winnerAnimation: d.winnerAnimation, audioEnabled: d.audioEnabled, volume: d.volume,
    fadeInMs: d.fadeInMs, fadeOutMs: d.fadeOutMs, cues: { ...cues } };
}
export interface ResultPagination { presentationStyle?: 'classic' | 'show'; pageSize?: 6 | 8 }
export function normalizeResultPagination(value: ResultPagination | Record<string, unknown>): Required<ResultPagination> {
  const presentationStyle = value.presentationStyle === undefined ? 'classic' : value.presentationStyle, pageSize = value.pageSize === undefined ? 8 : value.pageSize;
  if ((presentationStyle !== 'classic' || pageSize !== 8) && (presentationStyle !== 'show' || pageSize !== 6)) throw new Error('Invalid result pagination.');
  return { presentationStyle, pageSize };
}
export function resultPagination(presentationStyle: unknown): Required<ResultPagination> {
  if (presentationStyle === undefined || presentationStyle === 'classic') return { presentationStyle: 'classic', pageSize: 8 };
  if (presentationStyle === 'show') return { presentationStyle: 'show', pageSize: 6 };
  throw new Error('Invalid result style.');
}
export interface PublicResultRow { rank: number; teamName: string; halfPoints: number; movement?: number }
export const showCueKinds = ['interim', 'lower', 'third', 'second', 'winners', 'final-intro', 'reveal'] as const;
export interface ShowCue {
  id: string;
  kind: typeof showCueKinds[number];
  motion: 'animate' | 'static';
  intensity: ShowPreferences['motion'];
  topThree: boolean;
  winnerAnimation: boolean;
  startedAt: number;
  durationMs: number;
}
export function parseShowCue(value: unknown): ShowCue {
  const d = object(value); exact(d, ['id', 'kind', 'motion', 'intensity', 'topThree', 'winnerAnimation', 'startedAt', 'durationMs']);
  if (typeof d.id !== 'string' || !/^[a-f0-9]{64}$/u.test(d.id) || !showCueKinds.includes(d.kind as ShowCue['kind'])
    || !['animate', 'static'].includes(String(d.motion)) || !['none', 'subtle', 'show'].includes(String(d.intensity))
    || typeof d.topThree !== 'boolean' || typeof d.winnerAnimation !== 'boolean'
    || !integer(d.startedAt) || !integer(d.durationMs, 10000)) throw new Error('Invalid show cue.');
  return { id: d.id, kind: d.kind as ShowCue['kind'], motion: d.motion as ShowCue['motion'], intensity: d.intensity as ShowCue['intensity'],
    topThree: d.topThree, winnerAnimation: d.winnerAnimation, startedAt: d.startedAt, durationMs: d.durationMs };
}
export interface InterimBackdrop {
  renderMode: 'question' | 'recap' | 'roundIntro' | 'agenda' | 'rules' | 'end';
  slideKind: string; title: string; text: string; options?: readonly string[];
  roundTitle?: string; questionNumber?: number; questionCount?: number;
  design?: SlideDesign; backgroundImage?: string; questionImage?: string;
  backgroundOverlay?: number; imageLayout?: string;
}
export function parseInterimBackdrop(value: unknown): InterimBackdrop {
  const d = object(value); exact(d, ['renderMode', 'slideKind', 'title', 'text', 'options', 'roundTitle', 'questionNumber', 'questionCount', 'design', 'backgroundImage', 'questionImage', 'backgroundOverlay', 'imageLayout']);
  if (!['question', 'recap', 'roundIntro', 'agenda', 'rules', 'end'].includes(String(d.renderMode))
    || !['slideKind', 'title', 'text'].every(k => typeof d[k] === 'string' && (d[k]).length <= 20000)
    || (d.options !== undefined && (!Array.isArray(d.options) || !d.options.every(o => typeof o === 'string' && o.length <= 20000)))
    || ['roundTitle', 'backgroundImage', 'questionImage', 'imageLayout'].some(k => d[k] !== undefined && (typeof d[k] !== 'string' || (d[k]).length > 20000))
    || ['questionNumber', 'questionCount'].some(k => d[k] !== undefined && !integer(d[k]))
    || ['backgroundImage', 'questionImage'].some(k => d[k] !== undefined && !safeDesignImage(d[k]))
    || (d.backgroundOverlay !== undefined && (typeof d.backgroundOverlay !== 'number' || !Number.isFinite(d.backgroundOverlay) || d.backgroundOverlay < 0 || d.backgroundOverlay > 100))) throw new Error('Invalid interim backdrop.');
  if (d.design !== undefined) {
    const normalized = normalizeSlideDesign(d.design);
    if (JSON.stringify(normalized) !== JSON.stringify(d.design)) {
      const raw = object(d.design);
      if (Object.keys(raw).length !== Object.keys(normalized).length || Object.entries(raw).some(([key, entry]) => normalized[key as keyof SlideDesign] !== entry)) throw new Error('Invalid backdrop design.');
    }
  }
  return { ...d } as unknown as InterimBackdrop;
}
