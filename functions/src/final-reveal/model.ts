import type { FinalRevealPage, FinalRevealState } from '@filmovy-kviz/quiz-domain';
import { HttpsError } from 'firebase-functions/v2/https';
import { RESULTS_PAGE_SIZE, type ResultRow } from '../leaderboard/model.js';

export type FinalAction = 'start' | 'replace' | 'reveal' | 'hide' | 'resume' | 'page' | 'table';
export function revealRanks(rows: ResultRow[]): number[] {
  return [...new Set(rows.map(r => r.rank))].sort((a, b) => b - a);
}
export function initialFinal(versionId: string, rows: ResultRow[]): FinalRevealState {
  if (!rows.length) throw new HttpsError('failed-precondition', 'Prázdné finále nelze zahájit.');
  return { versionId, visible: true, mode: 'intro', revealedCount: 0, totalGroups: revealRanks(rows).length, rank: null, page: 0, pageCount: 1 };
}
export function advanceFinal(state: FinalRevealState, rows: ResultRow[], action: Exclude<FinalAction, 'start' | 'replace'>, page?: number): FinalRevealState {
  if (action === 'hide') {
    if (!state.visible) throw new HttpsError('failed-precondition', 'Finále je již skryté.');
    return { ...state, visible: false };
  }
  if (action === 'resume') {
    if (state.visible) throw new HttpsError('failed-precondition', 'Finále je již zobrazené.');
    return { ...state, visible: true };
  }
  if (!state.visible) throw new HttpsError('failed-precondition', 'Nejprve pokračujte ve skrytém finále.');
  if (action === 'reveal') {
    const rank = revealRanks(rows)[state.revealedCount];
    if (rank === undefined) throw new HttpsError('failed-precondition', 'Všechna umístění jsou odhalená.');
    return { ...state, mode: 'group', revealedCount: state.revealedCount + 1, rank, page: 0, pageCount: Math.ceil(rows.filter(r => r.rank === rank).length / RESULTS_PAGE_SIZE) };
  }
  if (action === 'table') {
    if (state.revealedCount !== state.totalGroups) throw new HttpsError('failed-precondition', 'Nejprve odhalte všechna umístění.');
    return { ...state, mode: 'table', rank: null, page: 0, pageCount: Math.ceil(rows.length / RESULTS_PAGE_SIZE) };
  }
  if (state.mode === 'intro' || !Number.isSafeInteger(page) || page! < 0 || page! >= state.pageCount || page === state.page)
    throw new HttpsError('invalid-argument', 'Neplatná stránka finále.');
  return { ...state, page: page! };
}
export function publicFinalPage(state: FinalRevealState, rows: ResultRow[]): FinalRevealPage {
  if (!state.visible) throw new HttpsError('failed-precondition', 'Skryté finále nelze publikovat.');
  const allowed = state.mode === 'intro' ? [] : state.mode === 'group' ? rows.filter(r => r.rank === state.rank) : rows;
  if (state.mode === 'table' && state.revealedCount !== state.totalGroups) throw new HttpsError('failed-precondition', 'Pořadí ještě nebylo odhalené.');
  return { versionId: state.versionId, mode: state.mode, rank: state.rank, page: state.page, pageCount: state.pageCount,
    groupSize: state.mode === 'group' ? allowed.length : 0,
    rows: allowed.slice(state.page * RESULTS_PAGE_SIZE, (state.page + 1) * RESULTS_PAGE_SIZE).map(r => ({ rank: r.rank, teamName: r.teamName, halfPoints: r.halfPoints })) };
}
