import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { printCenterFixture, printModeratorIdentity } from '../e2e/print-center-fixture.mjs';

const screenshots = '.local-data/product-stabilization/print';
async function login(page: Page, identity: { email: string; password: string }) {
  await page.goto('/admin/login');
  await page.getByLabel('E-mail', { exact: true }).fill(identity.email);
  await page.getByLabel('Heslo', { exact: true }).fill(identity.password);
  await page.getByRole('button', { name: 'Přihlásit se', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Administrace', exact: true })).toBeVisible();
}
async function ready(page: Page) {
  const frame = page.getByTitle('Náhled PDF', { exact: true });
  await expect(frame).toBeVisible();
  await expect(frame).toHaveAttribute('src', /^blob:/u);
  await expect(frame).toHaveAttribute('src', /#navpanes=0&view=Fit$/u);
  await expect(page.getByRole('link', { name: 'Stáhnout PDF', exact: true })).toHaveAttribute('href', (await frame.getAttribute('src'))?.split('#')[0] ?? 'missing');
}
async function downloaded(page: Page, info: TestInfo, name: string) {
  await ready(page);
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'Stáhnout PDF', exact: true }).click()]);
  const directory = process.env.PRINT_REVIEW_OUTPUT_DIR ?? info.outputDir;
  await mkdir(directory, { recursive: true });
  const file = path.join(directory, name);
  await download.saveAs(file);
  expect(await download.failure()).toBeNull();
  const bytes = await readFile(file);
  expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
  const pdf = await PDFDocument.load(bytes);
  expect(pdf.getPageCount()).toBeGreaterThan(0);
  for (const page of pdf.getPages()) {
    expect(Math.min(page.getWidth(), page.getHeight())).toBeCloseTo(595.28, 1);
    expect(Math.max(page.getWidth(), page.getHeight())).toBeCloseTo(841.89, 1);
  }
  return pdf;
}
async function shot(page: Page, name: string) {
  await mkdir(screenshots, { recursive: true });
  // Chromium paints its native PDF viewer out of process after iframe load.
  // This bounded settling delay is only for evidence capture, never a readiness assertion.
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(750);
  const mask = [page.locator('.admin-account > strong')];
  await page.screenshot({ path: path.join(screenshots, name + '.png'), mask });
  // A full-page screenshot resizes the viewport without repainting Chromium's
  // native PDF guest. Capture the actual visible viewer separately instead.
  await page.getByTitle('Náhled PDF', { exact: true }).scrollIntoViewIfNeeded();
  await page.waitForTimeout(750);
  await page.screenshot({ path: path.join(screenshots, name + '-pdf.png'), mask });
}

test('three materials use immediate real PDF previews, accepted teams and the locked quiz', async ({ page }, info) => {
  const fixture = await printCenterFixture(2, 8);
  try {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await login(page, fixture);
    await page.goto('/admin/events/' + fixture.eventId);
    await page.getByRole('link', { name: 'Tisk a materiály', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Tisk a materiály', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Odpovědní archy pro týmy/u })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.print-advanced')).not.toHaveAttribute('open');
    await expect(page.getByRole('button', { name: 'Vytvořit náhled', exact: true })).toHaveCount(0);
    await expect(page.getByText('Přijaté týmy: 2', { exact: true })).toBeVisible();
    const sheets = await downloaded(page, info, 'odpovedni-archy-2-tymy.pdf');
    expect(sheets.getPageCount()).toBe(16);
    await expect(page.getByRole('button', { name: 'Vytisknout', exact: true })).toHaveCount(0);
    await shot(page, 'tymove-archy-1920');
    await page.getByRole('button', { name: /^Bodovací tabulka/u }).click();
    await ready(page);
    await shot(page, 'bodovaci-tabulka-vice-kol');
    await page.getByRole('button', { name: /^Klíč správných odpovědí/u }).click();
    await expect(page.getByText(/nedávejte ho hráčům/u)).toBeVisible();
    await downloaded(page, info, 'klic-spravnych-odpovedi.pdf');
    await shot(page, 'klic-odpovedi');
    await page.setViewportSize({ width: 390, height: 844 });
    await shot(page, 'tisk-mobilni');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  } finally { await fixture.dispose(); }
});

test('zero accepted teams offer an immediate blank sheet and an honest empty score table', async ({ page }, info) => {
  const fixture = await printCenterFixture(0, 3);
  try {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await login(page, fixture);
    await page.goto('/admin/events/' + fixture.eventId + '/print');
    await expect(page.getByRole('heading', { name: 'Akce zatím nemá přijaté týmy', exact: true })).toBeVisible();
    expect((await downloaded(page, info, 'prazdny-odpovedni-arch.pdf')).getPageCount()).toBe(3);
    await shot(page, 'zadne-tymy');
    await page.getByRole('button', { name: /^Bodovací tabulka/u }).click();
    await expect(page.locator('.print-actions a')).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByTitle('Náhled PDF', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Zobrazit prázdný arch', exact: true })).toBeVisible();
  } finally { await fixture.dispose(); }
});

test('thirty accepted teams download fully and advanced choices remain transient', async ({ page }, info) => {
  const fixture = await printCenterFixture(30, 3);
  try {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await login(page, fixture);
    await page.goto('/admin/events/' + fixture.eventId + '/print');
    expect((await downloaded(page, info, 'odpovedni-archy-30-tymu.pdf')).getPageCount()).toBe(90);
    await shot(page, 'tricet-tymu');
    const sourceBefore = await fixture.snapshotData();
    await page.locator('.print-advanced > summary').click();
    await page.getByRole('combobox', { name: 'Prostor na odpovědi', exact: true }).selectOption('compact');
    await page.getByRole('combobox', { name: 'Logo v záhlaví', exact: true }).selectOption('hide');
    await page.getByRole('combobox', { name: 'Pokyny pro týmy', exact: true }).selectOption('hide');
    await ready(page);
    expect(await fixture.snapshotData()).toEqual(sourceBefore);
    await page.getByRole('button', { name: /^Bodovací tabulka/u }).click();
    await downloaded(page, info, 'bodovaci-tabulka-30-tymu.pdf');
    await shot(page, 'bodovaci-tabulka-30-tymu');
  } finally { await fixture.dispose(); }
});

test('answer keys stay disabled for moderators and an unprepared event has no PDF', async ({ page }) => {
  const fixture = await printCenterFixture(2, 3), moderator = await printModeratorIdentity();
  try {
    await login(page, moderator);
    await page.goto('/admin/events/' + fixture.eventId + '/print');
    await expect(page.getByRole('button', { name: /^Klíč správných odpovědí/u })).toBeDisabled();
    await ready(page);
    await page.getByRole('button', { name: 'Odhlásit se', exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/login$/u);
    await login(page, fixture);
    await fixture.unprepare();
    await page.goto('/admin/events/' + fixture.eventId + '/print');
    await expect(page.getByRole('heading', { name: 'Nejdříve připravte kvíz pro tuto akci', exact: true })).toBeVisible();
    await expect(page.getByTitle('Náhled PDF', { exact: true })).toHaveCount(0);
  } finally { await moderator.dispose(); await fixture.dispose(); }
});
