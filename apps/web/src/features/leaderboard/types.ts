import { normalizeResultPagination, type PublicResultRow, type ResultPagination } from '@filmovy-kviz/quiz-domain';
export type ResultRow = PublicResultRow;
export interface ResultPage extends ResultPagination {
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
    if (Object.keys(v).some(key => !['versionId', 'roundNumber', 'page', 'pageCount', 'rows', 'presentationStyle', 'pageSize'].includes(key))
        || typeof v.versionId !== 'string' || !/^[a-f0-9]{64}$/u.test(v.versionId)
        || !Number.isSafeInteger(v.roundNumber) || (v.roundNumber as number) < 1
        || !Number.isSafeInteger(v.page) || !Number.isSafeInteger(v.pageCount) || (v.pageCount as number) < 1 || (v.page as number) < 0 || (v.page as number) >= (v.pageCount as number)
        || !Array.isArray(v.rows) || v.rows.length < 1)
        throw new Error('Invalid published results.');
    const pagination = normalizeResultPagination(v);
    if (v.rows.length > pagination.pageSize) throw new Error('Oversized public result page.');
    const rows = v.rows.map((row: unknown) => parseResultRow(row, pagination.presentationStyle === 'show'));
    return { versionId: v.versionId, roundNumber: v.roundNumber as number, page: v.page as number, pageCount: v.pageCount as number, rows,
      ...(v.presentationStyle === undefined ? {} : { presentationStyle: pagination.presentationStyle }), ...(v.pageSize === undefined ? {} : { pageSize: pagination.pageSize }) };
}

export function parseResultRow(row: unknown, allowMovement = false): ResultRow {
        if (!row || typeof row !== 'object')
            throw new Error('Invalid result row.');
        const r = row as Record<string, unknown>;
        if (Object.keys(r).some(key => !['rank', 'teamName', 'halfPoints', ...(allowMovement ? ['movement'] : [])].includes(key)) || typeof r.teamName !== 'string' || r.teamName.length === 0 || r.teamName.length > 20000 || !Number.isSafeInteger(r.rank) || (r.rank as number) < 1 || !Number.isSafeInteger(r.halfPoints) || (r.halfPoints as number) < 0 || (r.movement !== undefined && !Number.isSafeInteger(r.movement)))
            throw new Error('Invalid result row.');
        return { rank: r.rank as number, teamName: r.teamName, halfPoints: r.halfPoints as number, ...(r.movement === undefined ? {} : { movement: r.movement as number }) };
}
