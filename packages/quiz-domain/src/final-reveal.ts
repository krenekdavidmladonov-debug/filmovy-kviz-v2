import type { PublicResultRow, ResultPagination } from './show-mode.js';
/** Public content is only explicitly revealed bounded pages, never the private ranking. */
export interface FinalRevealPage extends ResultPagination {
  versionId: string;
  mode: 'intro' | 'lower' | 'group' | 'table';
  rank: number | null;
  page: number;
  pageCount: number;
  groupSize: number;
  rows: PublicResultRow[];
  history?: { page: number; pageCount: number; pageSize: 6; rows: PublicResultRow[] };
}

/** Private session pointer; immutable rows live in finalVersions. */
export interface FinalRevealState extends ResultPagination {
  versionId: string;
  visible: boolean;
  mode: FinalRevealPage['mode'];
  revealedCount: number;
  totalGroups: number;
  rank: number | null;
  page: number;
  pageCount: number;
  historyPage?: number;
}
