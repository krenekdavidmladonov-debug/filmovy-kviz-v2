import { normalizeResultPagination, type FinalRevealPage, type ShowCue } from '@filmovy-kviz/quiz-domain';
import { parseResultRow } from '../leaderboard/types';
export interface FinalResponse { sessionId: string; versionId: string; revision: number; winnerRevealed: boolean; replayed: boolean; showCue?: ShowCue }
export function parseFinalPage(value: unknown): FinalRevealPage {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid final page.');
  const v = value as Record<string, unknown>;
  const pagination = normalizeResultPagination(v);
  if (Object.keys(v).some(key => !['versionId', 'mode', 'rank', 'page', 'pageCount', 'groupSize', 'rows', 'presentationStyle', 'pageSize', 'history'].includes(key))
    || typeof v.versionId !== 'string' || !/^[a-f0-9]{64}$/u.test(v.versionId)
    || !['intro', 'lower', 'group', 'table'].includes(v.mode as string) || !Array.isArray(v.rows)
    || !Number.isSafeInteger(v.groupSize) || (v.groupSize as number) < 0
    || !Number.isSafeInteger(v.page) || (v.page as number) < 0 || !Number.isSafeInteger(v.pageCount) || (v.pageCount as number) < 1 || (v.page as number) >= (v.pageCount as number)) throw new Error('Invalid final page.');
  const metadata = { ...(v.presentationStyle === undefined ? {} : { presentationStyle: pagination.presentationStyle }), ...(v.pageSize === undefined ? {} : { pageSize: pagination.pageSize }) };
  if (v.mode === 'intro') {
    if (v.rows.length || v.rank !== null || v.page !== 0 || v.pageCount !== 1 || v.groupSize !== 0 || v.history !== undefined) throw new Error('Unsafe final intro.');
    return { versionId: v.versionId, mode: 'intro', rank: null, page: 0, pageCount: 1, groupSize: 0, rows: [], ...metadata };
  }
  if (!v.rows.length || v.rows.length > pagination.pageSize) throw new Error('Invalid final rows.');
  const rows = v.rows.map(row => parseResultRow(row));
  if (v.mode === 'group' ? !Number.isSafeInteger(v.rank) || (v.rank as number) < 1 || rows.some(r => r.rank !== v.rank) || (v.groupSize as number) < rows.length || Math.ceil((v.groupSize as number) / pagination.pageSize) !== v.pageCount : v.rank !== null || v.groupSize !== 0) throw new Error('Invalid final group.');
  if (v.mode === 'group' && rows.length !== Math.min(pagination.pageSize, (v.groupSize as number) - (v.page as number) * pagination.pageSize)) throw new Error('Incomplete final group page.');
  if (v.mode === 'lower' && (pagination.presentationStyle !== 'show' || rows.some(row => row.rank <= 3))) throw new Error('Unsafe lower ranks.');
  let history: FinalRevealPage['history'];
  if (v.history !== undefined) {
    if (v.mode !== 'group' || pagination.presentationStyle !== 'show' || !v.history || typeof v.history !== 'object' || Array.isArray(v.history)) throw new Error('Invalid final history.');
    const h = v.history as Record<string, unknown>;
    if (Object.keys(h).sort().join() !== ['page', 'pageCount', 'pageSize', 'rows'].sort().join() || h.pageSize !== 6
      || !Number.isSafeInteger(h.page) || (h.page as number) < 0 || !Number.isSafeInteger(h.pageCount) || (h.pageCount as number) < 1 || (h.page as number) >= (h.pageCount as number)
      || !Array.isArray(h.rows) || h.rows.length < 1 || h.rows.length > 6) throw new Error('Invalid final history page.');
    const historyRows = h.rows.map(row => parseResultRow(row));
    if (historyRows.some(row => row.rank <= (v.rank as number))) throw new Error('Unrevealed rank in final history.');
    history = { page: h.page as number, pageCount: h.pageCount as number, pageSize: 6, rows: historyRows };
  }
  return { versionId: v.versionId, mode: v.mode as 'group' | 'lower' | 'table', rank: v.rank as number | null, groupSize: v.groupSize as number, rows, page: v.page as number, pageCount: v.pageCount as number, ...metadata, ...(history ? { history } : {}) };
}
