import { PDFDocument } from 'pdf-lib';
import { describe, expect, test } from 'vitest';

import { renderPrintArtifact } from '../functions/src/print/renderer';
import { answerDisplay, mapSnapshotToPrintEvent } from '../functions/src/print/snapshot-mapper';
import { syntheticPrintEvent, syntheticSnapshotDocuments, syntheticTeams } from './printCenter.fixture';

describe('PDF Print Center renderer', () => {
  test('renders deterministic A4 team sheets for 20 synthetic teams', async () => {
    const event = syntheticPrintEvent();
    const options = { artifactType: 'team-sheets', disposition: 'inline', mode: 'all', teams: syntheticTeams() } as const;
    const first = await renderPrintArtifact(event, options);
    const second = await renderPrintArtifact(event, options);
    expect(Buffer.from(first.bytes).equals(Buffer.from(second.bytes))).toBe(true);
    expect(first.filename).toBe('hraci-archy.pdf');
    expect(first.pageCount).toBeGreaterThanOrEqual(20);
    const pdf = await PDFDocument.load(first.bytes);
    expect(pdf.getPageCount()).toBe(first.pageCount);
    expect(pdf.getTitle()).toBe('JustKvíz — tiskové centrum');
    expect(pdf.getAuthor()).toBe('JustKvíz');
    expect(pdf.getCreator()).toBe('JustKvíz');
    expect(pdf.getPages()[0]?.getWidth()).toBeCloseTo(595.28, 1);
    expect(first.bytes.byteLength).toBeLessThan(10 * 1024 * 1024);
  }, 20_000);

  test('renders a private answer key with canonical Choice labels', async () => {
    expect(answerDisplay({ answer: 'Správná možnost', choiceLabel: 'B' })).toBe('B — Správná možnost');
    expect(answerDisplay({ answer: 'Pravda' })).toBe('Pravda');
    const result = await renderPrintArtifact(syntheticPrintEvent(), { artifactType: 'answer-key', disposition: 'inline' });
    expect(result.filename).toBe('klic-spravnych-odpovedi.pdf');
    expect(result.pageCount).toBeGreaterThan(0);
    await expect(PDFDocument.load(result.bytes)).resolves.toBeDefined();
  });

  test('uses landscape and multiple pages for the score table when rounds grow', async () => {
    const event = syntheticPrintEvent();
    event.quiz.rounds.push(...event.quiz.rounds.map((round, index) => ({ ...round, number: index + 6, title: `Další kolo ${index + 6}` })));
    const result = await renderPrintArtifact(event, { artifactType: 'score-table', disposition: 'inline', teams: syntheticTeams(30) });
    const pdf = await PDFDocument.load(result.bytes);
    expect(result.filename).toBe('bodovaci-tabulka.pdf');
    expect(result.pageCount).toBeGreaterThan(1);
    expect(pdf.getPages().every((page) => page.getWidth() > page.getHeight())).toBe(true);
  });
});

describe('trusted snapshot mapper', () => {
  test('maps only print fields and drops prompts, media, notes, legacy data, and internal IDs', () => {
    const { rounds, slides } = syntheticSnapshotDocuments();
    const mapped = mapSnapshotToPrintEvent(
      { title: 'Syntetická akce' },
      { status: 'ready', quizTitle: 'Syntetický kvíz' },
      rounds,
      slides,
    );
    const json = JSON.stringify(mapped);
    expect(mapped.quiz.rounds).toHaveLength(5);
    expect(mapped.quiz.rounds.flatMap((round) => round.questions)).toHaveLength(50);
    expect(json).not.toMatch(/TAJNÝ TEXT|TAJNÁ POZNÁMKA|TAJNÉ-MEDIA-ID|LEGACY RAW|private-slide|round-/u);
    expect(mapped.quiz.rounds[0]?.questions[0]).toEqual({ number: 1, kind: 'choice', answer: 'Možnost B', choiceLabel: 'B' });
  });
});
