import type { FinalRevealPage, ResultTemplate } from '@filmovy-kviz/quiz-domain';
import { ResultsTable } from '../leaderboard/ResultsTable';
import { slideDesignStyle } from '../presentation/design';
import { ResultBackdrop, ResultBrand } from '../presentation/ResultBackdrop';
import './final-reveal.css';
export function FinalRevealView(page: FinalRevealPage & { readonly template?: ResultTemplate | undefined; readonly mediaSessionId?: string | undefined }) {
  if (page.mode === 'table') return <ResultsTable final {...page} />;
  return <article style={slideDesignStyle(page.template?.design)} className={`final-canvas final-mode-${page.mode} result-layout-${page.template?.design?.layout ?? 'classic'}${page.rank === 1 ? ' is-winner' : ''}${page.rows.length > 4 ? ' is-large' : ''}`} aria-label="Finální vyhlášení">
    <ResultBackdrop template={page.template} mediaSessionId={page.mediaSessionId} />
    <header><p><ResultBrand template={page.template} mediaSessionId={page.mediaSessionId} /><span>FINÁLNÍ VYHLÁŠENÍ</span></p>
      <h1>{page.template?.title || (page.mode === 'intro' ? 'Děkujeme za hru' : page.rank === 1 ? page.groupSize > 1 ? 'Vítězné týmy' : 'Vítězný tým' : 'Gratulujeme')}</h1>
      {page.mode === 'intro' ? <p className="final-intro">{page.template?.subtitle || 'Za chvíli odhalíme konečné pořadí.'}</p> : <><p className="final-rank">{page.rank}. místo{page.groupSize > 1 ? ' · sdílené umístění' : ''}</p>{page.template?.subtitle && <p className="final-subtitle">{page.template.subtitle}</p>}</>}
    </header>
    {page.mode === 'group' && <ul>{page.rows.map((r, i) => <li key={i}><strong title={r.teamName}>{r.teamName}</strong><span>{(r.halfPoints / 2).toLocaleString('cs-CZ')} b.</span></li>)}</ul>}
    {page.mode === 'group' && <footer>Strana {page.page + 1} z {page.pageCount} · {page.rank}. místo</footer>}
  </article>;
}
