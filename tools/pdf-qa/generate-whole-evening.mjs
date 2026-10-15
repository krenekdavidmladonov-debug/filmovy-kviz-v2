// Local, synthetic evidence only. No Firebase, no credentials, no real quiz content.
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { renderPrintArtifact } from '../../functions/lib/print/renderer.js';

const output = resolve('.local-data/whole-evening/evidence');
await mkdir(output, { recursive: true });
const event = {
  title: 'Filmový večer - Kavárna U kina',
  quiz: {
    title: 'Ukázkový filmový kvíz',
    printTemplate: { title: 'Filmový večer', instructions: 'Pište čitelně. U výběrových otázek stačí písmeno A, B nebo C. Po skončení kola odevzdejte arch moderátorovi.', footer: 'JustKvíz / Děkujeme, že hrajete s námi.', accentColor: '#a87521', layout: 'comfortable' },
    rounds: ['Světové filmové příběhy', 'Filmové melodie', 'Poznáte hlavního hrdinu?', 'Pravda, nebo lež?', 'Česká filmová klasika'].map((title, index) => ({
      number: index + 1, title,
      questions: Array.from({ length: 10 }, (_, q) => ({ number: q + 1, kind: q % 3 === 0 ? 'choice' : 'free', answer: `Syntetická odpověď ${q + 1} - příliš žluťoučký kůň úpěl ďábelské ódy.`, ...(q % 3 === 0 ? { choiceLabel: 'B' } : {}) })),
    })),
  },
};
const teams = Array.from({ length: 30 }, (_, index) => ({ id: `synthetic-team-${index + 1}`, name: index === 29 ? 'Žluťoučcí koně a jejich přátelé z poslední řady filmového sálu' : `Filmový tým ${String(index + 1).padStart(2, '0')}` }));
const summary = [];
async function sample(name, source, options) {
  const started = performance.now();
  const artifact = await renderPrintArtifact(source, options);
  await writeFile(resolve(output, name + '.pdf'), artifact.bytes);
  summary.push({ name, pages: artifact.pageCount, bytes: artifact.bytes.length, durationMs: Math.round(performance.now() - started) });
}
await sample('hraci-arch-pohodlny', event, { artifactType: 'team-sheets', disposition: 'inline', mode: 'single', teams: [teams[29]] });
await sample('hraci-arch-usporny', { ...event, quiz: { ...event.quiz, printTemplate: { ...event.quiz.printTemplate, layout: 'compact' } } }, { artifactType: 'team-sheets', disposition: 'inline', mode: 'generic', teams: [] });
await sample('klic-odpovedi', event, { artifactType: 'answer-key', disposition: 'inline' });
await sample('bodovaci-tabulka', event, { artifactType: 'score-table', disposition: 'inline', teams });
await sample('hraci-arch-zalamovani', { ...event, title: 'Dlouhý název '.repeat(35), quiz: { ...event.quiz, printTemplate: { title: 'Dlouhý nadpis s diakritikou '.repeat(4), instructions: 'Pokyny k vyplnění odpovědního archu. '.repeat(11), footer: 'Dlouhá patička odpovědního archu. '.repeat(5) }, rounds: [{ ...event.quiz.rounds[0], title: 'Dlouhé kolo s diakritikou '.repeat(20), questions: Array.from({ length: 25 }, (_, q) => ({ number: q + 1, kind: 'free', answer: 'secret' })) }] } }, { artifactType: 'team-sheets', disposition: 'inline', mode: 'single', teams: [teams[29]] });
await writeFile(resolve(output, 'pdf-summary.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
