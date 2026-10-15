import type { SlideRenderInput } from '../features/presentation/types';

export type Scene = 'interim' | 'finale' | 'winner';
export interface ResultRow {
  readonly id: string;
  readonly rank: number;
  readonly name: string;
  readonly halfPoints: number;
  /** Only an explicitly confirmed, previously published ranking is a baseline. */
  readonly previousPublishedRank?: number;
}

export const question: SlideRenderInput = {
  kind: 'question',
  title: 'Filmové dvojice',
  text: 'Která dvojice se poprvé potkala ve filmu Pulp Fiction?',
  options: ['Uma Thurman a John Travolta', 'Brad Pitt a Edward Norton', 'Tom Hanks a Meg Ryan', 'Leonardo DiCaprio a Kate Winslet'],
  media: [],
  questionNumber: 8,
  questionCount: 10,
  roundTitle: '3. KOLO · FILMOVÉ DVOJICE',
  design: { backgroundColor: '#0B1220', textColor: '#F8FAFC', accentColor: '#FFC107' },
};

/** Synthetic fixtures only. Never use a complete final table as a public payload. */
export function results(ties: boolean, coWinners: boolean): readonly ResultRow[] {
  const rows: ResultRow[] = [
    { id: 'a', rank: 1, name: 'Až naprší a uschne', halfPoints: 97, previousPublishedRank: 2 },
    { id: 'b', rank: 2, name: 'Páni kluci', halfPoints: 92, previousPublishedRank: 1 },
    ...(ties ? [{ id: 'c', rank: 2, name: 'Ztraceni v překladu', halfPoints: 92, previousPublishedRank: 4 }] : []),
    { id: 'd', rank: 3, name: 'Pelíšky', halfPoints: 89, previousPublishedRank: 5 },
    { id: 'e', rank: 4, name: 'Obvyklí podezřelí', halfPoints: 86, previousPublishedRank: 3 },
    { id: 'f', rank: 5, name: 'Krotitelé otazníků', halfPoints: 82, previousPublishedRank: 5 },
    { id: 'g', rank: 6, name: 'Klub rváčů', halfPoints: 79, previousPublishedRank: 7 },
    { id: 'h', rank: 7, name: 'Poslední skauti', halfPoints: 76, previousPublishedRank: 6 },
    { id: 'i', rank: 8, name: 'Velký Gatsby', halfPoints: 71, previousPublishedRank: 8 },
    { id: 'j', rank: 9, name: 'Teorie všeho', halfPoints: 68, previousPublishedRank: 10 },
    { id: 'k', rank: 10, name: 'Návrat do budoucnosti', halfPoints: 66, previousPublishedRank: 9 },
    { id: 'l', rank: 11, name: 'Mimo záběr', halfPoints: 61, previousPublishedRank: 11 },
  ];
  const scored = rows.map(row => coWinners && (row.id === 'b' || row.id === 'c') ? { ...row, halfPoints: 97 } : row);
  const uniqueScores = [...new Set(scored.map(row => row.halfPoints))].sort((a, b) => b - a);
  return scored.map(row => ({ ...row, rank: uniqueScores.indexOf(row.halfPoints) + 1 }));
}

export function points(halfPoints: number): string {
  return new Intl.NumberFormat('cs-CZ', { maximumFractionDigits: 1 }).format(halfPoints / 2);
}
