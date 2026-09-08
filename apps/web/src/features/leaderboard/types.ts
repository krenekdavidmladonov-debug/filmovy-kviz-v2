export interface ResultRow {
    rank: number;
    teamName: string;
    halfPoints: number;
}
export interface ResultPage {
    versionId: string;
    roundNumber: number;
    page: number;
    pageCount: number;
    rows: ResultRow[];
}
export interface ResultsPreview {
    throughRoundId: string;
    roundNumber: number;
    includedRounds: {
        id: string;
        title: string;
        position: number;
    }[];
    rows: ResultRow[];
    missing: {
        teamId: string;
        teamName: string;
        roundId: string;
        roundTitle: string;
    }[];
    complete: boolean;
    sourceFingerprint: string;
    sessionRevision: number;
    publishedVersionId: string | null;
}
export function parseResultPage(value: unknown): ResultPage {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error('Invalid published results.');
    const v = value as Record<string, unknown>;
    if (Object.keys(v).sort().join() !== ['versionId', 'roundNumber', 'page', 'pageCount', 'rows'].sort().join()
        || typeof v.versionId !== 'string' || !/^[a-f0-9]{64}$/u.test(v.versionId)
        || !Number.isSafeInteger(v.roundNumber) || (v.roundNumber as number) < 1
        || !Number.isSafeInteger(v.page) || !Number.isSafeInteger(v.pageCount) || (v.pageCount as number) < 1 || (v.page as number) < 0 || (v.page as number) >= (v.pageCount as number)
        || !Array.isArray(v.rows) || v.rows.length < 1 || v.rows.length > 8)
        throw new Error('Invalid published results.');
    const rows = v.rows.map((row: unknown) => {
        if (!row || typeof row !== 'object')
            throw new Error('Invalid result row.');
        const r = row as Record<string, unknown>;
        if (Object.keys(r).sort().join() !== ['rank', 'teamName', 'halfPoints'].sort().join() || typeof r.teamName !== 'string' || !Number.isSafeInteger(r.rank) || (r.rank as number) < 1 || !Number.isSafeInteger(r.halfPoints) || (r.halfPoints as number) < 0)
            throw new Error('Invalid result row.');
        return { rank: r.rank as number, teamName: r.teamName, halfPoints: r.halfPoints as number };
    });
    return { versionId: v.versionId, roundNumber: v.roundNumber as number, page: v.page as number, pageCount: v.pageCount as number, rows };
}
