import type { FinalRevealPage } from '@filmovy-kviz/quiz-domain';
import { parseResultPage } from '../leaderboard/types';
export interface FinalResponse { sessionId: string; versionId: string; revision: number; winnerRevealed: boolean; replayed: boolean }
export function parseFinalPage(value: unknown): FinalRevealPage {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid final page.');
  const v = value as Record<string, unknown>;
  if (Object.keys(v).sort().join() !== ['versionId', 'mode', 'rank', 'page', 'pageCount', 'groupSize', 'rows'].sort().join()
    || typeof v.versionId !== 'string' || !/^[a-f0-9]{64}$/u.test(v.versionId)
    || !['intro', 'group', 'table'].includes(v.mode as string) || !Array.isArray(v.rows)
    || !Number.isSafeInteger(v.groupSize) || (v.groupSize as number) < 0) throw new Error('Invalid final page.');
  if (v.mode === 'intro') {
    if (v.rows.length || v.rank !== null || v.page !== 0 || v.pageCount !== 1 || v.groupSize !== 0) throw new Error('Unsafe final intro.');
    return { versionId: v.versionId, mode: 'intro', rank: null, page: 0, pageCount: 1, groupSize: 0, rows: [] };
  }
  const parsed = parseResultPage({ versionId: v.versionId, roundNumber: 1, page: v.page, pageCount: v.pageCount, rows: v.rows });
  if (v.mode === 'group' ? !Number.isSafeInteger(v.rank) || parsed.rows.some(r => r.rank !== v.rank) || (v.groupSize as number) < parsed.rows.length || Math.ceil((v.groupSize as number) / 8) !== parsed.pageCount : v.rank !== null || v.groupSize !== 0) throw new Error('Invalid final group.');
  return { versionId: parsed.versionId, mode: v.mode as 'group' | 'table', rank: v.rank as number | null, groupSize: v.groupSize as number, rows: parsed.rows, page: parsed.page, pageCount: parsed.pageCount };
}
