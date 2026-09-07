import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { renderPrintArtifact } from '../../functions/lib/print/renderer.js';

const kinds = ['choice', 'free', 'pl', 'audio', 'video'];
const event = {
  title: 'Filmový večer — Žluťoučký kůň úpěl ďábelské ódy',
  quiz: {
    title: 'Syntetický tiskový kvíz',
    rounds: Array.from({ length: 5 }, (_, roundIndex) => ({
      number: roundIndex + 1,
      title: `Kolo ${roundIndex + 1} — příliš dlouhý český název pro ověření zalamování`,
      questions: Array.from({ length: 10 }, (_, questionIndex) => {
        const kind = kinds[questionIndex % kinds.length];
        return {
          number: questionIndex + 1,
          kind,
          answer: kind === 'choice'
            ? 'Správná syntetická možnost B'
            : kind === 'pl'
              ? (questionIndex % 2 ? 'Lež' : 'Pravda')
              : `Syntetická odpověď ${questionIndex + 1}: Příliš žluťoučký kůň bezpečně ověřuje dlouhé zalamování bez skutečných kvízových dat a bez mediálních identifikátorů.`,
          ...(kind === 'choice' ? { choiceLabel: 'B' } : {}),
        };
      }),
    })),
  },
};
const teams = Array.from({ length: 20 }, (_, index) => ({
  name: index === 19 ? 'Tým 20 — Žluťoučcí koně s mimořádně dlouhým syntetickým názvem' : `Tým ${String(index + 1).padStart(2, '0')}`,
}));
const variants = [
  { artifactType: 'team-sheets', disposition: 'inline', mode: 'all', teams },
  { artifactType: 'answer-key', disposition: 'inline' },
  { artifactType: 'score-table', disposition: 'inline', teams },
];

const outputDirectory = resolve('.local-data/pdf-qa');
await mkdir(outputDirectory, { recursive: true });
const summary = [];
for (const options of variants) {
  const artifact = await renderPrintArtifact(event, options);
  const path = resolve(outputDirectory, artifact.filename);
  await writeFile(path, artifact.bytes);
  summary.push({ filename: artifact.filename, pages: artifact.pageCount, bytes: artifact.bytes.byteLength });
}
console.log(JSON.stringify({ outputDirectory, artifacts: summary }, null, 2));
