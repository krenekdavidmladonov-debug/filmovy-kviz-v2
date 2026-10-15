import { useEffect, useRef, useState } from 'react';
import type { ResultTemplate } from '@filmovy-kviz/quiz-domain';
import { ResultsTable } from '../leaderboard/ResultsTable';
import { FinalRevealView } from '../final-reveal/FinalRevealView';

const sampleRows = [
  { rank: 1, teamName: 'Ukázkový tým · Filmoví znalci', halfPoints: 48 },
  { rank: 2, teamName: 'Ukázkový tým · Druhá klapka', halfPoints: 43 },
  { rank: 3, teamName: 'Ukázkový tým · Poslední záběr', halfPoints: 40 },
  { rank: 4, teamName: 'Ukázkový tým · Sovy', halfPoints: 37 },
  { rank: 5, teamName: 'Ukázkový tým · Bez nápovědy', halfPoints: 34 },
  { rank: 6, teamName: 'Ukázkový tým · Lišky', halfPoints: 30 },
  { rank: 7, teamName: 'Ukázkový tým · Ještě jeden tip', halfPoints: 29 },
  { rank: 8, teamName: 'Ukázkový tým · Osm statečných', halfPoints: 26 },
];

export function ResultTemplatePreview({ kind, template, onEdit }: {
  readonly kind: 'interim' | 'final';
  readonly template: ResultTemplate;
  readonly onEdit: () => void;
}) {
  const [mode, setMode] = useState<'intro' | 'group' | 'table'>('group');
  const stage = useRef<HTMLDivElement>(null);
  const [overflowing, setOverflowing] = useState(false);
  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const measure = () => {
      const area = element.getBoundingClientRect();
      if (!area.width) return;
      const clipped = [...element.querySelectorAll('h1, .results-subtitle, .final-subtitle, .final-intro, tbody tr, li, footer')].some(item => {
        const bounds = item.getBoundingClientRect();
        return bounds.bottom > area.bottom + 2 || bounds.right > area.right + 2
          || item.scrollHeight > item.clientHeight + 2;
      });
      setOverflowing(clipped);
    };
    const frame = requestAnimationFrame(measure);
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, [kind, mode, template]);
  return <aside className="round-editor-preview editor-panel-preview">
    <header className="preview-heading"><span>Náhled výsledkové šablony</span><strong>{kind === 'final' ? 'Finální vyhlášení' : 'Průběžné pořadí'}</strong><button type="button" className="secondary-button" onClick={onEdit}>Upravit slide</button></header>
    <div className="local-preview-label">Ukázka rozložení · skutečné výsledky doplní akce</div>
    {kind === 'final' && <label className="form-field">Obrazovka vyhlášení<select value={mode} onChange={event => setMode(event.target.value as typeof mode)}><option value="intro">Úvod vyhlášení</option><option value="group">Odhalení vítěze</option><option value="table">Celkové pořadí</option></select></label>}
    <div ref={stage} className="preview-stage result-template-stage">{kind === 'interim' ? <ResultsTable roundNumber={1} page={0} pageCount={1} rows={sampleRows} template={template} /> : <FinalRevealView versionId="editor-sample" mode={mode} rank={mode === 'group' ? 1 : null} groupSize={mode === 'group' ? 1 : 0} page={0} pageCount={1} rows={mode === 'intro' ? [] : mode === 'group' ? sampleRows.slice(0, 1) : sampleRows} template={template} />}</div>
    {overflowing && <p className="field-validation warning" role="status">Část výsledkové šablony se nevejde na plochu. Zkraťte doprovodné texty nebo zmenšete písmo; uložení je možné.</p>}
    <p className="field-help">Ukázkové týmy a body slouží pouze k posouzení vzhledu. Nic se neukládá do výsledků ani nepublikuje.</p>
  </aside>;
}
