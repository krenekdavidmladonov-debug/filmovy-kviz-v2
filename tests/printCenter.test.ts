import { PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import { PNG } from 'pngjs';
import { describe, expect, test } from 'vitest';

import { renderPrintArtifact } from '../functions/src/print/renderer';
import { answerDisplay, mapSnapshotToPrintEvent } from '../functions/src/print/snapshot-mapper';
import { syntheticPrintEvent, syntheticSnapshotDocuments, syntheticTeams } from './printCenter.fixture';
import { printLogoAsset } from '../functions/src/print/logo';
import type { PrintOptions } from '../functions/src/print/types';
import { assertCurrentPrintSource } from '../functions/src/print/source-guard';

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

  test('keeps comfortable rounds on separate pages and uses fewer pages in compact mode', async () => {
    const event = syntheticPrintEvent();
    const options: PrintOptions = { artifactType: 'team-sheets', disposition: 'inline', mode: 'generic', teams: [] };
    const comfortable = await renderPrintArtifact(event, options);
    expect(comfortable.pageCount).toBe(5);
    event.quiz.printTemplate = { layout: 'compact', title: 'Kvízový večer', instructions: 'Pište čitelně.', footer: 'Děkujeme všem týmům.', accentColor: '#b89242', showLogo: false };
    const compact = await renderPrintArtifact(event, options);
    expect(compact.pageCount).toBeLessThan(comfortable.pageCount);
  });

  test('never draws answers or choice labels on player sheets, even when secret values change', async () => {
    const event = syntheticPrintEvent();
    const options: PrintOptions = { artifactType: 'team-sheets', disposition: 'inline', mode: 'generic', teams: [] };
    const first = await renderPrintArtifact(event, options);
    event.quiz.rounds.forEach(round => round.questions.forEach(question => { question.answer = 'UNREVEALED-SECRET-CHANGED'; question.choiceLabel = 'Z'; }));
    const second = await renderPrintArtifact(event, options);
    expect(Buffer.from(first.bytes).equals(Buffer.from(second.bytes))).toBe(true);
  });

  test('embeds a verified raster logo, and hiding it avoids reading its bytes', async () => {
    const event = syntheticPrintEvent();
    const png = new PNG({ width: 40, height: 10 });
    png.data.fill(255);
    event.logo = { bytes: PNG.sync.write(png), contentType: 'image/png' };
    const options: PrintOptions = { artifactType: 'team-sheets', disposition: 'inline', mode: 'generic', teams: [] };
    const pdf = await PDFDocument.load((await renderPrintArtifact(event, options)).bytes);
    expect(pdf.context.enumerateIndirectObjects().some(([, value]) => value instanceof PDFRawStream && value.dict.get(PDFName.of('Subtype'))?.toString() === '/Image')).toBe(true);
    event.quiz.printTemplate = { showLogo: false };
    event.logo.bytes = new Uint8Array([1, 2, 3]);
    await expect(renderPrintArtifact(event, options)).resolves.toBeDefined();
    event.quiz.printTemplate = { showLogo: true };
    await expect(renderPrintArtifact(event, options)).rejects.toMatchObject({ code: 'invalid-logo' });
  });

  test('paginates long round names and continuing questions without exceeding A4', async () => {
    const event = syntheticPrintEvent();
    event.quiz.rounds = [{ number: 1, title: 'Velmi dlouhý název kola '.repeat(20), questions: Array.from({ length: 35 }, (_, index) => ({ number: index + 1, kind: 'free', answer: 'tajné' })) }];
    event.quiz.printTemplate = { title: 'Dlouhý nadpis '.repeat(9), instructions: 'Čitelně zapisujte odpovědi. '.repeat(15), footer: 'Děkujeme za příjemný večer. '.repeat(5) };
    const result = await renderPrintArtifact(event, { artifactType: 'team-sheets', disposition: 'inline', mode: 'single', teams: [syntheticTeams(20)[19]!] });
    expect(result.pageCount).toBeGreaterThan(1);
    expect((await PDFDocument.load(result.bytes)).getPages().every(page => page.getHeight() === 841.89)).toBe(true);
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

describe('print logo immutable ownership boundary', () => {
  const reference = 'quiz-asset:quiz-1/' + 'a'.repeat(64);
  const asset = { quizId: 'quiz-1', status: 'ready', kind: 'image', contentType: 'image/png', size: 123, generation: '42' };
  test('accepts only verified PNG/JPEG at a concrete generation', () => {
    expect(printLogoAsset(reference, 'quiz-1', asset)).toMatchObject({ quizId: 'quiz-1', generation: '42', contentType: 'image/png' });
  });
  test.each([
    ['https://example.test/logo.png', 'quiz-1', asset],
    [reference, 'other-quiz', asset],
    [reference, 'quiz-1', { ...asset, status: 'pending' }],
    [reference, 'quiz-1', { ...asset, generation: undefined }],
    [reference, 'quiz-1', { ...asset, kind: 'audio' }],
    [reference, 'quiz-1', { ...asset, contentType: 'image/webp' }],
  ])('rejects external, unrelated, unready or unsupported logo %s', (value, quizId, metadata) => {
    expect(() => printLogoAsset(value, quizId, metadata)).toThrow();
  });
});

describe('print generation source consistency', () => {
  const assignment = { snapshotId: 'snapshot-1', quizId: 'quiz-1', quizRevision: 2 };
  const snapshot = { status: 'ready', quizId: 'quiz-1', quizRevision: 2, eventId: 'event-1' };
  test('allows the unchanged frozen source', () => expect(() => assertCurrentPrintSource(assignment, { ...assignment }, snapshot, 'event-1')).not.toThrow());
  test.each([
    [{ ...assignment, snapshotId: 'snapshot-2' }, snapshot],
    [{ ...assignment, quizId: 'other' }, snapshot],
    [{ ...assignment, quizRevision: 3 }, snapshot],
    [undefined, snapshot],
    [assignment, undefined],
    [assignment, { ...snapshot, status: 'building' }],
    [assignment, { ...snapshot, eventId: 'other-event' }],
  ])('rejects relock, detachment or deletion before bytes leave the server', (current, frozen) => expect(() => assertCurrentPrintSource(assignment, current, frozen, 'event-1')).toThrow());
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
  test('uses bounded frozen print template rather than mutable event values', () => {
    const { rounds, slides } = syntheticSnapshotDocuments();
    const mapped = mapSnapshotToPrintEvent({ title: 'Akce', printTemplate: { title: 'IGNORED' } }, { status: 'ready', quizTitle: 'Kvíz', printTemplate: { title: 'Zamčená šablona', footer: 'A'.repeat(200), unknown: 'secret' } }, rounds, slides);
    expect(mapped.quiz.printTemplate).toEqual({ title: 'Zamčená šablona', footer: 'A'.repeat(160) });
  });
});
