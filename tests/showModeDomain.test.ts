import { describe, expect, test } from 'vitest';
import { defaultShowPreferences, normalizeResultPagination, normalizeShowPreferences, parseInterimBackdrop, parseShowCue, resultPagination } from '../packages/quiz-domain/src/show-mode';
import { advanceFinal, initialFinal, publicFinalPage } from '../functions/src/final-reveal/model';
import { calculateFinalResults } from '../functions/src/leaderboard/model';

const version = 'a'.repeat(64), show = resultPagination('show');
const rows = Array.from({ length: 13 }, (_, i) => ({ rank: i + 1, teamName: `Tým ${i + 1}`, halfPoints: 26 - i }));
describe('show protocol and six-row authoritative pages', () => {
  test('legacy defaults stay classic eight and explicit mismatches/null fail closed', () => {
    expect(normalizeResultPagination({})).toEqual({ presentationStyle: 'classic', pageSize: 8 });
    expect(normalizeResultPagination(show)).toEqual(show);
    for (const data of [{ pageSize: 6 }, { presentationStyle: 'show' }, { presentationStyle: 'show', pageSize: 8 }, { pageSize: null }, { presentationStyle: null }]) expect(() => normalizeResultPagination(data)).toThrow();
    const explicitClassic = initialFinal(version, rows, resultPagination('classic'));
    expect(explicitClassic.pageSize).toBe(8);
    expect(publicFinalPage(explicitClassic, rows)).not.toHaveProperty('pageSize');
    expect(publicFinalPage(explicitClassic, rows)).not.toHaveProperty('presentationStyle');
  });
  test.each([6, 7, 8, 9, 12, 13])('all %i tied winners are paginated with no lost or duplicated rows', count => {
    const tied = Array.from({ length: count }, (_, i) => ({ rank: 1, teamName: `Tým ${i}`, halfPoints: 3 }));
    let state = advanceFinal(initialFinal(version, tied, show), tied, 'reveal');
    const published = [];
    for (let page = 0; page < state.pageCount; page++) {
      if (page) state = advanceFinal(state, tied, 'page', page);
      const current = publicFinalPage(state, tied);
      expect(current.groupSize).toBe(count); expect(current.rows.length).toBeLessThanOrEqual(6);
      expect(state.revealedCount).toBe(1); published.push(...current.rows);
    }
    expect(published).toEqual(tied);
    const classic = advanceFinal(initialFinal(version, tied), tied, 'reveal');
    expect(publicFinalPage(classic, tied).rows).toHaveLength(Math.min(8, count));
  });
  test('bulk publishes only lower ranks, then manual podium and bounded prior history', () => {
    let state = initialFinal(version, rows, show);
    expect(publicFinalPage(state, rows).rows).toEqual([]);
    expect(() => advanceFinal(state, rows, 'table')).toThrow();
    state = advanceFinal(state, rows, 'reveal-lower');
    expect(state.revealedCount).toBe(10); expect(state.mode).toBe('lower');
    expect(publicFinalPage(state, rows).rows.map(r => r.rank)).toEqual([13, 12, 11, 10, 9, 8]);
    state = advanceFinal(state, rows, 'page', 1);
    expect(publicFinalPage(state, rows).rows.map(r => r.rank)).toEqual([7, 6, 5, 4]);
    expect(() => advanceFinal(state, rows, 'reveal-lower')).toThrow();
    state = advanceFinal(state, rows, 'reveal');
    const podium = publicFinalPage(state, rows);
    expect(podium.rank).toBe(3); expect(podium.rows).toEqual([rows[2]]);
    expect(podium.history?.rows).toHaveLength(6);
    expect(podium.history?.rows.every(r => r.rank > 3)).toBe(true);
    state = advanceFinal(state, rows, 'history-page', 1);
    expect(publicFinalPage(state, rows).history?.rows.map(r => r.rank)).toEqual([7, 6, 5, 4]);
    expect(() => advanceFinal(state, rows, 'history-page', 2)).toThrow();
    for (const rank of [2, 1]) { state = advanceFinal(state, rows, 'reveal'); expect(state.rank).toBe(rank); expect(state.historyPage).toBe(0); }
    state = advanceFinal(state, rows, 'table'); expect(publicFinalPage(state, rows).history).toBeUndefined();
    expect(publicFinalPage(state, rows).rows).toHaveLength(6);
  });
  test('classic cannot bulk and hiding/static never advance groups', () => {
    expect(() => advanceFinal(initialFinal(version, rows), rows, 'reveal-lower')).toThrow();
    let state = advanceFinal(initialFinal(version, rows, show), rows, 'reveal');
    expect(advanceFinal(state, rows, 'static')).toEqual(state);
    const hidden = advanceFinal(state, rows, 'hide');
    expect(() => publicFinalPage(hidden, rows)).toThrow();
    expect(advanceFinal(hidden, rows, 'resume')).toEqual(state);
    state = advanceFinal(state, rows, 'reveal');
    expect(() => publicFinalPage({ ...state, rank: 1 }, rows)).toThrow();
  });
  test('1000 co-winners fit private version shape and all 167 public pages stay bounded', () => {
    const started = performance.now();
    const teams = Array.from({ length: 1000 }, (_, i) => ({ id: i.toString(16).padStart(64, '0'), name: '😀'.repeat(38) + String(i).padStart(4, '0'), revision: 1 }));
    const scores = teams.map(team => ({ teamId: team.id, roundId: 'round', halfPoints: 1, revision: 1 }));
    const calculated = calculateFinalResults([{ id: 'round', title: 'Kolo', position: 1 }], teams, scores);
    expect(calculated.complete).toBe(true);
    // This measures application JSON, not Firestore's wire encoding. Canonical
    // registration IDs are 64 characters and names have the allowed 80 UTF-16 units.
    const privateShape = { versionId: version, rows: calculated.rows, rowTeamIds: calculated.rowTeamIds, teamRanks: calculated.teamRanks, ...show };
    expect(Buffer.byteLength(JSON.stringify(privateShape))).toBeLessThan(512 * 1024);
    let state = advanceFinal(initialFinal(version, calculated.rows, show), calculated.rows, 'reveal');
    expect(state.pageCount).toBe(167); expect(state.totalGroups).toBe(1);
    const names: string[] = [];
    for (let page = 0; page < state.pageCount; page++) {
      if (page) state = advanceFinal(state, calculated.rows, 'page', page);
      const payload = publicFinalPage(state, calculated.rows);
      expect(payload.rows.length).toBe(page === 166 ? 4 : 6);
      expect(payload.groupSize).toBe(1000); expect(payload.history).toBeUndefined();
      expect(Buffer.byteLength(JSON.stringify(payload))).toBeLessThan(8 * 1024);
      names.push(...payload.rows.map(row => row.teamName));
    }
    expect(new Set(names).size).toBe(1000); expect(names).toEqual(calculated.rows.map(row => row.teamName));
    expect(() => calculateFinalResults([{ id: 'round', title: 'Kolo', position: 1 }], [...teams, { id: 'overflow', name: 'Další tým', revision: 1 }], scores)).toThrow(/1000/);
    // A generous CPU-only regression ceiling, not a venue/network latency claim.
    expect(performance.now() - started).toBeLessThan(2000);
  });
  test('1000 ranked teams expose all lower/history pages without any future podium rows', () => {
    const ranked = Array.from({ length: 1000 }, (_, i) => ({ rank: i + 1, teamName: `Tým-${i + 1}`, halfPoints: 2000 - i }));
    let state = advanceFinal(initialFinal(version, ranked, show), ranked, 'reveal-lower');
    expect(state.revealedCount).toBe(997); expect(state.pageCount).toBe(167);
    const lowerNames: string[] = [];
    for (let page = 0; page < state.pageCount; page++) {
      if (page) state = advanceFinal(state, ranked, 'page', page);
      const payload = publicFinalPage(state, ranked);
      expect(payload.rows.length).toBeLessThanOrEqual(6);
      expect(payload.rows.every(row => row.rank > 3)).toBe(true);
      expect(payload.history).toBeUndefined(); lowerNames.push(...payload.rows.map(row => row.teamName));
    }
    expect(new Set(lowerNames).size).toBe(997);
    state = advanceFinal(state, ranked, 'reveal');
    const historyNames: string[] = [];
    for (let page = 0; page < 167; page++) {
      if (page) state = advanceFinal(state, ranked, 'history-page', page);
      const payload = publicFinalPage(state, ranked);
      expect(payload.rows).toEqual([ranked[2]]);
      expect(payload.history?.rows.every(row => row.rank > 3)).toBe(true);
      expect(payload.history?.rows.length).toBeLessThanOrEqual(6);
      expect(Buffer.byteLength(JSON.stringify(payload))).toBeLessThan(8 * 1024);
      historyNames.push(...payload.history!.rows.map(row => row.teamName));
    }
    expect(historyNames).toEqual(lowerNames); expect(state.revealedCount).toBe(998);
    expect(() => advanceFinal(state, ranked, 'history-page', 167)).toThrow();
    expect(() => advanceFinal(state, ranked, 'table')).toThrow();
  });
});
describe('strict show settings and allowlists', () => {
  test('safe defaults and exactly five owned audio slots; no implicit permission', () => {
    expect(normalizeShowPreferences(undefined)).toEqual(defaultShowPreferences);
    const reference = 'quiz-asset:quiz/' + 'b'.repeat(64);
    expect(normalizeShowPreferences({ ...defaultShowPreferences, cues: { suspense: reference } }).cues).toEqual({ suspense: reference });
    for (const change of [{ volume: 1.1 }, { volume: NaN }, { fadeOutMs: 2001 }, { audioEnabled: 'yes' }, { cues: { third: reference } }, { cues: { winner: 'https://example.test/song.mp3' } }, { extra: true }]) expect(() => normalizeShowPreferences({ ...defaultShowPreferences, ...change })).toThrow();
  });
  test('cue is bounded and cannot carry audio references/private extensions', () => {
    const cue = { id: version, kind: 'winners', motion: 'animate', intensity: 'show', topThree: true, winnerAnimation: true, startedAt: 123, durationMs: 2400 };
    expect(parseShowCue(cue)).toEqual(cue);
    for (const change of [{ audioSource: 'private' }, { durationMs: 10001 }, { startedAt: -1 }, { id: 'client' }, { intensity: 'bright' }]) expect(() => parseShowCue({ ...cue, ...change })).toThrow();
  });
  test('backdrop rejects answer/media fields and unsafe design sources', () => {
    const backdrop = { renderMode: 'question', slideKind: 'question', title: 'Otázka', text: 'Prompt', options: ['A', 'B'] };
    expect(parseInterimBackdrop(backdrop)).toEqual(backdrop);
    for (const change of [{ revealedAnswer: 'secret' }, { answerDesign: {} }, { media: [] }, { mediaSource: 'audio' }, { design: { private: true } }, { questionImage: 'javascript:alert(1)' }]) expect(() => parseInterimBackdrop({ ...backdrop, ...change })).toThrow();
  });
});
