import { normalizeResultPagination, type FinalRevealPage, type FinalRevealState, type ResultPagination } from '@filmovy-kviz/quiz-domain';
import { HttpsError } from 'firebase-functions/v2/https';
import type { ResultRow } from '../leaderboard/model.js';

export type FinalAction = 'start' | 'replace' | 'reveal' | 'reveal-lower' | 'hide' | 'resume' | 'page' | 'history-page' | 'table' | 'static';
export function revealRanks(rows: ResultRow[]): number[] {
  return [...new Set(rows.map(r => r.rank))].sort((a, b) => b - a);
}
export function initialFinal(versionId: string, rows: ResultRow[], pagination: ResultPagination = {}): FinalRevealState {
  if (!rows.length) throw new HttpsError('failed-precondition', 'Prázdné finále nelze zahájit.');
  normalizeResultPagination(pagination);
  return { versionId, visible: true, mode: 'intro', revealedCount: 0, totalGroups: revealRanks(rows).length, rank: null, page: 0, pageCount: 1, ...pagination };
}
export function finalHistoryRows(state: FinalRevealState, rows: ResultRow[]): ResultRow[] {
  if (normalizeResultPagination(state).presentationStyle !== 'show' || state.mode !== 'group' || state.rank === null) return [];
  return rows.filter(r => r.rank > state.rank!).sort((a, b) => b.rank - a.rank);
}
export function advanceFinal(state: FinalRevealState, rows: ResultRow[], action: Exclude<FinalAction, 'start' | 'replace'>, page?: number): FinalRevealState {
  const { pageSize, presentationStyle } = normalizeResultPagination(state);
  if (action === 'hide') {
    if (!state.visible) throw new HttpsError('failed-precondition', 'Finále je již skryté.');
    return { ...state, visible: false };
  }
  if (action === 'resume') {
    if (state.visible) throw new HttpsError('failed-precondition', 'Finále je již zobrazené.');
    return { ...state, visible: true };
  }
  if (!state.visible) throw new HttpsError('failed-precondition', 'Nejprve pokračujte ve skrytém finále.');
  if (action === 'static') return { ...state };
  if (action === 'reveal-lower') {
    const ranks = revealRanks(rows).filter(rank => rank > 3);
    if (presentationStyle !== 'show' || state.mode !== 'intro' || state.revealedCount !== 0 || ranks.length === 0) throw new HttpsError('failed-precondition', 'Hromadné odhalení je dostupné jen na začátku show s nižšími umístěními.');
    return { ...state, mode: 'lower', revealedCount: ranks.length, rank: null, page: 0, pageCount: Math.ceil(rows.filter(r => r.rank > 3).length / pageSize) };
  }
  if (action === 'reveal') {
    const rank = revealRanks(rows)[state.revealedCount];
    if (rank === undefined) throw new HttpsError('failed-precondition', 'Všechna umístění jsou odhalená.');
    return { ...state, mode: 'group', revealedCount: state.revealedCount + 1, rank, page: 0,
      ...(presentationStyle === 'show' ? { historyPage: 0 } : {}), pageCount: Math.ceil(rows.filter(r => r.rank === rank).length / pageSize) };
  }
  if (action === 'table') {
    if (state.revealedCount !== state.totalGroups) throw new HttpsError('failed-precondition', 'Nejprve odhalte všechna umístění.');
    return { ...state, mode: 'table', rank: null, page: 0, pageCount: Math.ceil(rows.length / pageSize) };
  }
  if (action === 'history-page') {
    const history = finalHistoryRows(state, rows);
    if (!history.length || !Number.isSafeInteger(page) || page! < 0 || page! >= Math.ceil(history.length / 6) || page === (state.historyPage ?? 0)) throw new HttpsError('invalid-argument', 'Neplatná stránka odhalených umístění.');
    return { ...state, historyPage: page! };
  }
  if (state.mode === 'intro' || !Number.isSafeInteger(page) || page! < 0 || page! >= state.pageCount || page === state.page)
    throw new HttpsError('invalid-argument', 'Neplatná stránka finále.');
  return { ...state, page: page! };
}
export function publicFinalPage(state: FinalRevealState, rows: ResultRow[]): FinalRevealPage {
  if (!state.visible) throw new HttpsError('failed-precondition', 'Skryté finále nelze publikovat.');
  const { pageSize } = normalizeResultPagination(state);
  const allowed = state.mode === 'intro' ? [] : state.mode === 'group' ? rows.filter(r => r.rank === state.rank)
    : state.mode === 'lower' ? rows.filter(r => r.rank > 3).sort((a, b) => b.rank - a.rank) : rows;
  if ((state.mode === 'table' && state.revealedCount !== state.totalGroups)
    || (state.mode === 'lower' && (normalizeResultPagination(state).presentationStyle !== 'show' || state.revealedCount !== revealRanks(rows).filter(r => r > 3).length))
    || (state.mode === 'group' && revealRanks(rows)[state.revealedCount - 1] !== state.rank)) throw new HttpsError('failed-precondition', 'Pořadí ještě nebylo odhalené.');
  const clean = (r: ResultRow) => ({ rank: r.rank, teamName: r.teamName, halfPoints: r.halfPoints });
  const history = finalHistoryRows(state, rows), historyPage = state.historyPage ?? 0;
  return { versionId: state.versionId, mode: state.mode, rank: state.rank, page: state.page, pageCount: state.pageCount,
    ...(state.presentationStyle === 'show' ? { presentationStyle: 'show' as const, pageSize: 6 as const } : {}),
    groupSize: state.mode === 'group' ? allowed.length : 0,
    rows: allowed.slice(state.page * pageSize, (state.page + 1) * pageSize).map(clean),
    ...(history.length ? { history: { page: historyPage, pageCount: Math.ceil(history.length / 6), pageSize: 6 as const, rows: history.slice(historyPage * 6, (historyPage + 1) * 6).map(clean) } } : {}) };
}
