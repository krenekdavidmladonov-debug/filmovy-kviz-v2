/** Public content is only one explicitly revealed page, never the private ranking. */
export interface FinalRevealPage {
  versionId: string;
  mode: 'intro' | 'group' | 'table';
  rank: number | null;
  page: number;
  pageCount: number;
  groupSize: number;
  rows: { rank: number; teamName: string; halfPoints: number }[];
}

/** Private session pointer; immutable rows live in finalVersions. */
export interface FinalRevealState {
  versionId: string;
  visible: boolean;
  mode: FinalRevealPage['mode'];
  revealedCount: number;
  totalGroups: number;
  rank: number | null;
  page: number;
  pageCount: number;
}
