import { describe, expect, test } from 'vitest';
import { parseResultPage } from '../apps/web/src/features/leaderboard/types';
import { parseFinalPage } from '../apps/web/src/features/final-reveal/types';
import { mapPublicLiveState } from '../apps/web/src/features/live/liveMappers';
import { parsePublicLiveState, parseProjectorChannelMessage, projectorPresentationAuthority, sanitizedChannelState } from '../apps/web/src/features/live/projectorChannel';

const versionId = 'a'.repeat(64);
const row = (rank = 3) => ({ rank, teamName: `Tým ${rank}`, halfPoints: 89 });
const metadata = { presentationStyle: 'show', pageSize: 6 } as const;
const interim = () => ({ versionId, roundNumber: 3, page: 0, pageCount: 1, rows: [row(1)], ...metadata });
const final = () => ({ versionId, mode: 'group', rank: 3, page: 0, pageCount: 1, groupSize: 1, rows: [row()], ...metadata });
const cue = () => ({ id: 'b'.repeat(64), kind: 'third', motion: 'animate', intensity: 'subtle', topThree: true, winnerAnimation: true, startedAt: 1000, durationMs: 2000 });
const state = () => ({ sessionId: 'synthetic-show', quizTitle: 'Syntetický večer', status: 'active', slidePosition: 8, options: [], media: [], presentation: {}, presentationMode: 'slide', renderMode: 'question', mediaCommand: 'idle', mediaPlaybackState: 'idle', mediaGeneration: 1, introGeneration: 0, answerRevealed: false, revision: 4 });

describe('strict public show pages', () => {
  test('show pages contain at most six rows; absent metadata keeps classic eight', () => {
    expect(parseResultPage(interim()).pageSize).toBe(6);
    expect(() => parseResultPage({ ...interim(), rows: Array.from({ length: 7 }, () => row()) })).toThrow();
    const legacy = { versionId, roundNumber: 1, page: 0, pageCount: 1, rows: Array.from({ length: 8 }, () => row()) };
    expect(parseResultPage(legacy)).toEqual(legacy);
    for (const invalid of [{ presentationStyle: 'show' }, { pageSize: 6 }, { presentationStyle: 'classic', pageSize: 6 }, { presentationStyle: 'show', pageSize: 8 }]) expect(() => parseResultPage({ ...legacy, ...invalid })).toThrow();
  });
  test('movement comes only from the bounded server interim shape', () => {
    expect(parseResultPage({ ...interim(), rows: [{ ...row(), movement: 2 }] }).rows[0]?.movement).toBe(2);
    for (const extras of [{ teamId: 'PRIVATE_ID' }, { email: 'PRIVATE_CONTACT' }, { previousRank: 2 }, { movement: .5 }, { correctAnswer: 'PRIVATE_ANSWER' }]) expect(() => parseResultPage({ ...interim(), rows: [{ ...row(), ...extras }] })).toThrow();
    expect(() => parseFinalPage({ ...final(), rows: [{ ...row(), movement: 2 }] })).toThrow();
  });
  test('ten co-winners are explicit six-row pages without hidden names', () => {
    const page = { ...final(), rank: 1, groupSize: 10, pageCount: 2, rows: Array.from({ length: 6 }, (_, index) => ({ ...row(1), teamName: `Vítěz ${index + 1}` })) };
    expect(parseFinalPage(page)).toEqual(page);
    expect(parseFinalPage({ ...page, page: 1, rows: page.rows.slice(0, 4) }).rows).toHaveLength(4);
    for (const invalid of [{ pageCount: 1 }, { page: 2 }, { rows: [...page.rows, row(1)] }, { rows: [row(2)] }, { hiddenRows: [row(1)] }]) expect(() => parseFinalPage({ ...page, ...invalid })).toThrow();
  });
  test('history can contain only previously revealed lower ranks and one bounded page', () => {
    const history = { page: 0, pageCount: 2, pageSize: 6, rows: [row(4), row(5)] };
    expect(parseFinalPage({ ...final(), history }).history).toEqual(history);
    for (const invalid of [{ ...history, rows: [row(1)] }, { ...history, rows: [row(3)] }, { ...history, rows: Array.from({ length: 7 }, () => row(4)) }, { ...history, allRows: [row(1)] }, { ...history, pageSize: 8 }]) expect(() => parseFinalPage({ ...final(), history: invalid })).toThrow();
    expect(() => parseFinalPage({ ...final(), mode: 'intro', rank: null, groupSize: 0, rows: [], history })).toThrow();
    expect(() => parseFinalPage({ ...final(), mode: 'lower', rank: null, groupSize: 0, rows: [row(2)] })).toThrow();
    expect(parseFinalPage({ ...final(), mode: 'lower', rank: null, groupSize: 0, rows: [row(5)] }).mode).toBe('lower');
  });
});

describe('public show boundary', () => {
  test('accepts and preserves a complete safe result payload and never grants channel authority', () => {
    const value = { ...state(), finalReveal: final(), showCue: cue(), design: { backgroundColor: '#0B1220', accentColor: '#FFC107' }, title: 'Finále', subtitle: 'Syntetická ukázka' };
    expect(parsePublicLiveState(value)).toEqual(value);
    expect(sanitizedChannelState(value as never)).toEqual(value);
    expect(projectorPresentationAuthority(value as never)).toBe('authoritative-only');
    expect(mapPublicLiveState('synthetic-show', { ...value, updatedAt: { seconds: 1 } })).toEqual(value);
  });
  test('refuses private extras at every public nested boundary instead of dropping them', () => {
    const base = { ...state(), interimResults: interim(), interimBackdrop: { renderMode: 'question', slideKind: 'question', title: 'Otázka', text: 'Zadání', options: ['A', 'B'] } };
    expect(parsePublicLiveState(base)).toEqual(base);
    for (const patch of [
      { correctAnswer: 'PRIVATE' }, { revealedAnswer: '' }, { answerExplanation: 'PRIVATE' }, { questionImage: 'https://example.test/private.png' }, { text: 'PRIVATE' },
      { media: [{ role: 'answer', kind: 'image', source: 'https://example.test/private.png' }] },
      { interimBackdrop: { ...base.interimBackdrop, revealedAnswer: 'PRIVATE' } },
      { interimBackdrop: { ...base.interimBackdrop, answerImage: 'https://example.test/private.png' } },
      { interimBackdrop: { ...base.interimBackdrop, mediaSource: 'https://example.test/private.mp3' } },
      { interimBackdrop: { ...base.interimBackdrop, design: { backgroundColor: '#123456', privateNotes: 'PRIVATE' } } },
      { design: { backgroundColor: '#123456', correctAnswer: 'PRIVATE' } },
      { interimResults: { ...interim(), fullRanking: [row(1)] } },
    ]) {
      const invalid = { ...base, ...patch };
      expect(parsePublicLiveState(invalid)).toBeUndefined();
      expect(parseProjectorChannelMessage({ type: 'public-state', state: invalid })).toBeUndefined();
      expect(() => mapPublicLiveState('synthetic-show', invalid)).toThrow();
    }
  });
  test('strict cues refuse malformed and private fields, backdrop requires visible show interim', () => {
    for (const patch of [{ id: 'not-an-operation-id' }, { durationMs: 10001 }, { startedAt: -1 }, { privateAudio: 'PRIVATE' }]) expect(parsePublicLiveState({ ...state(), finalReveal: final(), showCue: { ...cue(), ...patch } })).toBeUndefined();
    expect(parsePublicLiveState({ ...state(), showCue: cue() })).toBeUndefined();
    expect(parsePublicLiveState({ ...state(), finalReveal: final(), interimBackdrop: { renderMode: 'question', slideKind: 'question', title: '', text: '' } })).toBeUndefined();
    expect(parsePublicLiveState({ ...state(), interimResults: interim(), finalReveal: final() })).toBeUndefined();
  });
});
