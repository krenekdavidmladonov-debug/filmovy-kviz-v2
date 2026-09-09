import type { FinalRevealPage } from '@filmovy-kviz/quiz-domain';
import { ResultsTable } from '../leaderboard/ResultsTable';
import './final-reveal.css';
export function FinalRevealView(page: FinalRevealPage) {
  if (page.mode === 'table') return <ResultsTable final {...page} />;
  return <article className={`final-canvas${page.rank === 1 ? ' is-winner' : ''}${page.rows.length > 4 ? ' is-large' : ''}`} aria-label="Finální vyhlášení">
    <header><p>Filmový kvíz · finální vyhlášení</p>
      <h1>{page.mode === 'intro' ? 'Děkujeme za hru' : page.rank === 1 ? page.groupSize > 1 ? 'Vítězné týmy' : 'Vítězný tým' : `${page.rank}. místo`}</h1>
      {page.mode === 'intro' ? <p className="final-intro">Za chvíli odhalíme konečné pořadí.</p> : <p>{page.rank === 1 ? '1. místo' : page.groupSize > 1 ? 'Sdílené umístění' : 'Gratulujeme'}</p>}
    </header>
    {page.mode === 'group' && <ul>{page.rows.map((r, i) => <li key={i}><strong title={r.teamName}>{r.teamName}</strong><span>{(r.halfPoints / 2).toLocaleString('cs-CZ')} b.</span></li>)}</ul>}
    {page.mode === 'group' && <footer>Strana {page.page + 1} z {page.pageCount} · {page.rank}. místo</footer>}
  </article>;
}
