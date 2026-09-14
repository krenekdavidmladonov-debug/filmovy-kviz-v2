import { Brand } from '../../ui/Brand';
import type { ResultRow } from './types';
import './leaderboard.css';
export function ResultsTable({ roundNumber, page, pageCount, rows, final = false }: {
    roundNumber?: number;
    final?: boolean;
    page: number;
    pageCount: number;
    rows: readonly ResultRow[];
}) {
    return <article className="results-canvas" aria-label={final ? "Konečné pořadí" : "Průběžné výsledky"}>
    <header><p><Brand /> · {final ? "konečné" : "průběžné"} pořadí</p><h1>{final ? "Konečné pořadí" : `Průběžné výsledky po ${roundNumber}. kole`}</h1></header>
    <table><thead><tr><th scope="col">Pořadí</th><th scope="col">Tým</th><th scope="col">Body</th></tr></thead>
      <tbody>{rows.map((row, i) => <tr key={page * 8 + i}><td>{row.rank}.</td><th scope="row" title={row.teamName}>{row.teamName}</th><td>{Number(row.halfPoints / 2).toLocaleString('cs-CZ')}</td></tr>)}</tbody>
    </table><footer>Strana {page + 1} z {pageCount} · Shodné body znamenají shodné umístění.</footer>
  </article>;
}
