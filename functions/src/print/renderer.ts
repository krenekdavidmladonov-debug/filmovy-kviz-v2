import fontkit from '@pdf-lib/fontkit';
import { brand } from '@filmovy-kviz/quiz-domain';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { PDFDocument, rgb, type PDFFont, type PDFPage, type PDFImage } from 'pdf-lib';
import { PrintCenterError } from './errors.js';
import { PRINT_LIMITS } from './limits.js';
import { answerDisplay } from './snapshot-mapper.js';
import type { PrintEvent, PrintOptions, PrintTeam, RenderedPrintArtifact } from './types.js';

const require = createRequire(import.meta.url);
const PAGE = { width: 595.28, height: 841.89 } as const;
const MARGIN = 42;
const INK = rgb(0.08, 0.08, 0.08);
const MUTED = rgb(0.38, 0.38, 0.38);
const RULE = rgb(0.72, 0.72, 0.72);
const LIGHT = rgb(0.94, 0.94, 0.94);
const NAVY = rgb(0.1, 0.16, 0.25);
const GOLD = rgb(0.66, 0.46, 0.13);
const BOTTOM = 76;
const FIXED_DATE = new Date('2000-01-01T00:00:00.000Z');

interface FontFace {
  base: PDFFont;
  extended: PDFFont;
}

interface Fonts {
  regular: FontFace;
  bold: FontFace;
}

interface Layout {
  doc: PDFDocument;
  fonts: Fonts;
  page: PDFPage;
  width: number;
  height: number;
  y: number;
  startedAt: number;
  logo?: PDFImage;
}

let fontBytesPromise: Promise<[Uint8Array, Uint8Array, Uint8Array, Uint8Array]> | undefined;

function loadFontBytes(): Promise<[Uint8Array, Uint8Array, Uint8Array, Uint8Array]> {
  fontBytesPromise ??= Promise.all([
    readFile(require.resolve('@fontsource/noto-sans/files/noto-sans-latin-400-normal.woff')),
    readFile(require.resolve('@fontsource/noto-sans/files/noto-sans-latin-ext-400-normal.woff')),
    readFile(require.resolve('@fontsource/noto-sans/files/noto-sans-latin-700-normal.woff')),
    readFile(require.resolve('@fontsource/noto-sans/files/noto-sans-latin-ext-700-normal.woff')),
  ]);
  return fontBytesPromise;
}

function checkDeadline(layout: Layout): void {
  if (Date.now() - layout.startedAt > PRINT_LIMITS.generationMs) {
    throw new PrintCenterError(503, 'generation-timeout', 'Generování PDF překročilo časový limit.');
  }
}

function addPage(layout: Layout, landscape = false): PDFPage {
  checkDeadline(layout);
  if (layout.doc.getPageCount() >= PRINT_LIMITS.pages) {
    throw new PrintCenterError(422, 'page-limit', `Dokument překročil limit ${PRINT_LIMITS.pages} stran.`);
  }
  const size: [number, number] = landscape ? [PAGE.height, PAGE.width] : [PAGE.width, PAGE.height];
  layout.page = layout.doc.addPage(size);
  layout.width = size[0];
  layout.height = size[1];
  layout.y = layout.height - MARGIN;
  return layout.page;
}

function drawText(
  layout: Layout,
  text: string,
  x: number,
  y: number,
  size = 10,
  bold = false,
  color = INK,
): void {
  const face = bold ? layout.fonts.bold : layout.fonts.regular;
  let cursor = x;
  let run = '';
  let runFont = fontForCharacter(face, text[0] ?? ' ');
  const flush = (): void => {
    if (!run) return;
    layout.page.drawText(run, { x: cursor, y, size, font: runFont, color });
    cursor += runFont.widthOfTextAtSize(run, size);
    run = '';
  };
  for (const character of text) {
    const selected = fontForCharacter(face, character);
    if (selected !== runFont) {
      flush();
      runFont = selected;
    }
    run += character;
  }
  flush();
}

function fontForCharacter(face: FontFace, character: string): PDFFont {
  const codePoint = character.codePointAt(0) ?? 0;
  return codePoint >= 0x0100 && codePoint <= 0x024f ? face.extended : face.base;
}

function textWidth(text: string, face: FontFace, size: number): number {
  let width = 0;
  let run = '';
  let runFont = fontForCharacter(face, text[0] ?? ' ');
  const flush = (): void => {
    if (!run) return;
    width += runFont.widthOfTextAtSize(run, size);
    run = '';
  };
  for (const character of text) {
    const selected = fontForCharacter(face, character);
    if (selected !== runFont) {
      flush();
      runFont = selected;
    }
    run += character;
  }
  flush();
  return width;
}

function wrapText(text: string, font: FontFace, size: number, maxWidth: number): string[] {
  const normalized = text.trim().replace(/\s+/gu, ' ');
  if (!normalized) return [''];
  const lines: string[] = [];
  let current = '';
  for (const word of normalized.split(' ')) {
    const candidate = current ? `${current} ${word}` : word;
    if (textWidth(candidate, font, size) <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    let remainder = word;
    while (remainder && textWidth(remainder, font, size) > maxWidth) {
      let cut = 1;
      while (
        cut < remainder.length &&
        textWidth(remainder.slice(0, cut + 1), font, size) <= maxWidth
      ) cut += 1;
      lines.push(remainder.slice(0, cut));
      remainder = remainder.slice(cut);
    }
    current = remainder;
  }
  if (current) lines.push(current);
  return lines;
}

function drawHeader(layout: Layout, event: PrintEvent, documentTitle: string, team?: PrintTeam): void {
  const template = event.quiz.printTemplate ?? {};
  const available = layout.width - MARGIN * 2;
  if (template.showLogo !== false) {
    if (layout.logo) {
      const factor = Math.min(110 / layout.logo.width, 24 / layout.logo.height);
      layout.page.drawImage(layout.logo, { x: MARGIN, y: layout.y - 5, width: layout.logo.width * factor, height: layout.logo.height * factor });
    } else drawText(layout, template.logoText || brand.name, MARGIN, layout.y, 13, true, NAVY);
    drawText(layout, documentTitle === 'Hrací arch' ? 'ODPOVĚDNÍ LIST' : 'PRO POŘADATELE', layout.width - MARGIN - 116, layout.y + 1, 8, true, MUTED);
    layout.y -= 31;
  }
  for (const line of wrapText(template.title || event.title, layout.fonts.bold, 17, available)) {
    drawText(layout, line, MARGIN, layout.y, 17, true, NAVY);
    layout.y -= 23;
  }
  drawText(layout, documentTitle, MARGIN, layout.y - 2, 10, true, MUTED);
  layout.y -= 22;
  if (documentTitle === 'Hrací arch') {
    const label = team ? `Tým: ${team.name}` : 'Tým:';
    for (const line of wrapText(label, layout.fonts.bold, 11, available)) {
      drawText(layout, line, MARGIN, layout.y - 10, 11, true);
      layout.y -= 16;
    }
    if (!team) layout.page.drawLine({ start: { x: MARGIN + 40, y: layout.y + 3 }, end: { x: layout.width - MARGIN - 68, y: layout.y + 3 }, thickness: .65, color: RULE });
    drawText(layout, 'Stůl: ______', layout.width - MARGIN - 61, layout.y - 12, 8, false, MUTED);
    layout.y -= 23;
    const instructions = template.instructions || 'Zapisujte čitelně. Čísla odpovědí odpovídají otázkám v daném kole.';
    for (const line of wrapText(instructions, layout.fonts.regular, 9, available)) {
      drawText(layout, line, MARGIN, layout.y, 9, false, MUTED);
      layout.y -= 13;
    }
  }
  layout.y -= 8;
  const hex = template.accentColor?.replace('#', '');
  const expanded = hex?.length === 3 ? hex.split('').map(char => char + char).join('') : hex;
  const accent = expanded && /^[a-f\d]{6}$/iu.test(expanded) ? rgb(parseInt(expanded.slice(0, 2), 16) / 255, parseInt(expanded.slice(2, 4), 16) / 255, parseInt(expanded.slice(4, 6), 16) / 255) : GOLD;
  layout.page.drawLine({ start: { x: MARGIN, y: layout.y }, end: { x: MARGIN + 45, y: layout.y }, thickness: 2.5, color: accent });
  layout.page.drawLine({ start: { x: MARGIN + 53, y: layout.y }, end: { x: layout.width - MARGIN, y: layout.y }, thickness: .5, color: RULE });
  layout.y -= 24;
}

function ensureSpace(layout: Layout, required: number, nextPage: () => void): void {
  if (layout.y - required < BOTTOM) nextPage();
}

function drawRoundHeader(layout: Layout, round: PrintEvent['quiz']['rounds'][number], continuation = false): void {
  const lines = wrapText(`${round.number}. KOLO  /  ${round.title}${continuation ? ' (pokračování)' : ''}`, layout.fonts.bold, 11, layout.width - MARGIN * 2 - 20);
  const height = lines.length * 15 + 16;
  layout.page.drawRectangle({ x: MARGIN, y: layout.y - height + 8, width: layout.width - MARGIN * 2, height, color: LIGHT });
  lines.forEach((line, index) => drawText(layout, line, MARGIN + 10, layout.y - 11 - index * 15, 11, true, NAVY));
  layout.y -= height + 10;
}

function drawTeamSheet(layout: Layout, event: PrintEvent, team?: PrintTeam): void {
  const compact = event.quiz.printTemplate?.layout === 'compact';
  const rowHeight = compact ? 34 : 44;
  const repeatHeader = (): void => {
    addPage(layout);
    drawHeader(layout, event, 'Hrací arch', team);
  };
  event.quiz.rounds.forEach((round, roundIndex) => {
    if (!compact || roundIndex === 0) repeatHeader();
    const headingHeight = wrapText(`${round.number}. KOLO  /  ${round.title}`, layout.fonts.bold, 11, layout.width - MARGIN * 2 - 20).length * 15 + 26;
    ensureSpace(layout, headingHeight + rowHeight, repeatHeader);
    drawRoundHeader(layout, round);
    for (const question of round.questions) {
      if (layout.y - rowHeight < BOTTOM) { repeatHeader(); drawRoundHeader(layout, round, true); }
      drawText(layout, `${question.number}.`, MARGIN + 5, layout.y - 18, 12, true, NAVY);
      layout.page.drawLine({ start: { x: MARGIN + 36, y: layout.y - rowHeight + 9 }, end: { x: layout.width - MARGIN - 33, y: layout.y - rowHeight + 9 }, thickness: .65, color: RULE });
      layout.page.drawRectangle({ x: layout.width - MARGIN - 22, y: layout.y - 24, width: 22, height: 19, borderColor: RULE, borderWidth: .5 });
      layout.y -= rowHeight;
    }
    layout.y -= 14;
  });
}

function renderTeamSheets(layout: Layout, event: PrintEvent, options: Extract<PrintOptions, { artifactType: 'team-sheets' }>): void {
  const teams = options.mode === 'generic' ? [undefined] : options.teams;
  for (const team of teams) drawTeamSheet(layout, event, team);
}

function renderAnswerKey(layout: Layout, event: PrintEvent): void {
  addPage(layout);
  const repeatHeader = (): void => {
    addPage(layout);
    drawHeader(layout, event, 'Klíč správných odpovědí — pokračování');
  };
  drawHeader(layout, event, 'Klíč správných odpovědí');
  for (const round of event.quiz.rounds) {
    const headingHeight = wrapText(`${round.number}. KOLO  /  ${round.title}`, layout.fonts.bold, 11, layout.width - MARGIN * 2 - 20).length * 15 + 26;
    ensureSpace(layout, headingHeight + 56, repeatHeader);
    drawRoundHeader(layout, round);
    for (const question of round.questions) {
      const lines = wrapText(answerDisplay(question), layout.fonts.regular, 9, layout.width - MARGIN * 2 - 32);
      const rowHeight = Math.max(22, lines.length * 12 + 8);
      if (layout.y - rowHeight < BOTTOM) { repeatHeader(); drawRoundHeader(layout, round, true); }
      drawText(layout, `${question.number}.`, MARGIN + 4, layout.y - 10, 9, true);
      lines.forEach((line, index) => drawText(layout, line, MARGIN + 31, layout.y - 10 - index * 12, 9));
      layout.page.drawLine({ start: { x: MARGIN, y: layout.y - rowHeight + 2 }, end: { x: layout.width - MARGIN, y: layout.y - rowHeight + 2 }, thickness: 0.45, color: RULE });
      layout.y -= rowHeight;
    }
    layout.y -= 7;
  }
}

function drawScoreHeader(layout: Layout, roundNumbers: number[], columnWidths: number[]): void {
  const tableWidth = columnWidths.reduce((total, width) => total + width, 0);
  const top = layout.y;
  layout.page.drawRectangle({ x: MARGIN, y: top - 25, width: tableWidth, height: 25, color: LIGHT, borderColor: INK, borderWidth: 0.7 });
  const labels = ['Tým', ...roundNumbers.map((number) => `Kolo ${number}`), 'Celkem'];
  let x = MARGIN;
  labels.forEach((label, index) => {
    drawText(layout, label, x + 4, top - 16, index === 0 ? 8.5 : 7.3, true);
    x += columnWidths[index] ?? 0;
    if (index < labels.length - 1) layout.page.drawLine({ start: { x, y: top }, end: { x, y: top - 25 }, thickness: 0.6, color: RULE });
  });
  layout.y -= 25;
}

function renderScoreTable(layout: Layout, event: PrintEvent, teams: PrintTeam[]): void {
  const landscape = event.quiz.rounds.length > 5;
  const roundsPerSection = landscape ? 9 : 5;
  for (let start = 0; start < event.quiz.rounds.length; start += roundsPerSection) {
    const roundNumbers = event.quiz.rounds.slice(start, start + roundsPerSection).map((round) => round.number);
    let teamOffset = 0;
    while (teamOffset < teams.length) {
      addPage(layout, landscape);
      drawHeader(layout, event, start === 0 ? 'Bodovací tabulka' : `Bodovací tabulka — kola ${roundNumbers[0]}–${roundNumbers.at(-1)}`);
      drawText(layout, 'Body lze zapisovat po půlbodech (např. 7,5).', MARGIN, layout.y, 8.5, false, MUTED);
      layout.y -= 17;
      const available = layout.width - MARGIN * 2;
      const teamWidth = landscape ? 150 : 135;
      const totalWidth = 54;
      const scoreWidth = (available - teamWidth - totalWidth) / roundNumbers.length;
      const widths = [teamWidth, ...roundNumbers.map(() => scoreWidth), totalWidth];
      drawScoreHeader(layout, roundNumbers, widths);
      let pageTeamCount = 0;
      for (const team of teams.slice(teamOffset)) {
        const nameLines = wrapText(team.name, layout.fonts.regular, 9, teamWidth - 12);
        const rowHeight = Math.max(32, nameLines.length * 12 + 12);
        if (layout.y - rowHeight < BOTTOM) break;
        const top = layout.y;
        let x = MARGIN;
        layout.page.drawRectangle({ x, y: top - rowHeight, width: available, height: rowHeight, borderColor: RULE, borderWidth: 0.6 });
        nameLines.forEach((line, index) => drawText(layout, line, x + 6, top - 14 - index * 12, 9));
        widths.slice(0, -1).forEach((width) => {
          x += width;
          layout.page.drawLine({ start: { x, y: top }, end: { x, y: top - rowHeight }, thickness: 0.6, color: RULE });
        });
        layout.y -= rowHeight;
        pageTeamCount += 1;
      }
      if (pageTeamCount === 0) throw new PrintCenterError(422, 'layout-limit', 'Název týmu nebo záhlaví je příliš dlouhé pro bodovací tabulku. Zkraťte jej.');
      teamOffset += pageTeamCount;
    }
  }
}

function addPageNumbers(layout: Layout, event: PrintEvent): void {
  const { doc, fonts } = layout;
  const pages = doc.getPages();
  pages.forEach((page, index) => {
    layout.page = page;
    const footer = event.quiz.printTemplate?.footer ?? 'JustKvíz / Prostor pro vaše znalosti';
    const footerLines = wrapText(footer, fonts.regular, 8, page.getWidth() - MARGIN * 2 - 96);
    page.drawLine({ start: { x: MARGIN, y: 54 }, end: { x: page.getWidth() - MARGIN, y: 54 }, thickness: .5, color: RULE });
    footerLines.forEach((line, lineIndex) => drawText(layout, line, MARGIN, 39 - lineIndex * 11, 8, false, MUTED));
    const label = `Strana ${index + 1} / ${pages.length}`;
    const width = textWidth(label, fonts.regular, 8);
    page.drawText(label, { x: page.getWidth() - MARGIN - width, y: 39, size: 8, font: fonts.regular.base, color: MUTED });
  });
}

function filenameFor(options: PrintOptions): string {
  if (options.artifactType === 'answer-key') return 'klic-spravnych-odpovedi.pdf';
  if (options.artifactType === 'score-table') return 'bodovaci-tabulka.pdf';
  return 'hraci-archy.pdf';
}

export async function renderPrintArtifact(event: PrintEvent, options: PrintOptions): Promise<RenderedPrintArtifact> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const [regularBytes, regularExtendedBytes, boldBytes, boldExtendedBytes] = await loadFontBytes();
  const fonts: Fonts = {
    regular: {
      base: await doc.embedFont(new Uint8Array(regularBytes), { subset: true }),
      extended: await doc.embedFont(new Uint8Array(regularExtendedBytes), { subset: true }),
    },
    bold: {
      base: await doc.embedFont(new Uint8Array(boldBytes), { subset: true }),
      extended: await doc.embedFont(new Uint8Array(boldExtendedBytes), { subset: true }),
    },
  };
  doc.setTitle(`${brand.name} — tiskové centrum`);
  doc.setAuthor(brand.name);
  doc.setCreator(brand.name);
  doc.setProducer('pdf-lib');
  doc.setCreationDate(FIXED_DATE);
  doc.setModificationDate(FIXED_DATE);

  const placeholder = doc.addPage([PAGE.width, PAGE.height]);
  const layout: Layout = { doc, fonts, page: placeholder, width: PAGE.width, height: PAGE.height, y: 0, startedAt: Date.now() };
  if (event.quiz.printTemplate?.showLogo !== false && event.logo) {
    try { layout.logo = event.logo.contentType === 'image/png' ? await doc.embedPng(event.logo.bytes) : await doc.embedJpg(event.logo.bytes); }
    catch { throw new PrintCenterError(422, 'invalid-logo', 'Logo nelze vložit do PDF. Nahrajte platný PNG nebo JPEG soubor.'); }
  }
  doc.removePage(0);

  if (options.artifactType === 'team-sheets') renderTeamSheets(layout, event, options);
  else if (options.artifactType === 'answer-key') renderAnswerKey(layout, event);
  else renderScoreTable(layout, event, options.teams);

  addPageNumbers(layout, event);
  const bytes = await doc.save({ useObjectStreams: false, addDefaultPage: false, updateFieldAppearances: false });
  if (bytes.byteLength > PRINT_LIMITS.outputBytes) {
    throw new PrintCenterError(422, 'output-limit', 'Výsledné PDF překročilo povolenou velikost.');
  }
  return { bytes, pageCount: doc.getPageCount(), filename: filenameFor(options) };
}
