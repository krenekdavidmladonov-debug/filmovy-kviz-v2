/* global document, innerWidth */
import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { editorIdentity } from '../e2e/editor-identity.mjs';
import { mediaSlide } from '../e2e/media-fixture.mjs';

async function fixture(page) {
  const identity = await editorIdentity();
  const id = 'save-all-' + randomUUID(), root = identity.db.doc('quizzes/' + id);
  const batch = identity.db.batch();
  batch.set(root, { title: 'Společné ukládání', description: '', status: 'draft', revision: 0, slideCount: 4, roundCount: 1, questionCount: 2,
    createdAt: new Date(), updatedAt: new Date(), createdBy: 'synthetic', updatedBy: 'synthetic' });
  batch.set(root.collection('rounds').doc('round'), { title: 'Kolo', position: 1, type: 'classic', questionCount: 2, slideCount: 4 });
  for (const [i, key] of ['round', 'a', 'b', 'recap'].entries()) {
    const question = key === 'a' || key === 'b';
    batch.set(root.collection('slides').doc(key), { ...mediaSlide(question ? 'free' : key), position: i + 1,
      roundId: 'round', roundTitle: 'Kolo', isQuestion: question, title: question ? '' : 'Kolo',
      ...(question ? { text: key, correctAnswer: 'Odpověď', authoringStatus: 'ready', answerMode: 'open' } : {}) });
    if (question) batch.set(root.collection('rounds').doc('round').collection('questions').doc(key), { prompt: key, type: 'text', position: i });
  }
  await batch.commit();
  await page.context().route('**/*', r => ['127.0.0.1','localhost'].includes(new URL(r.request().url()).hostname) ? r.continue() : r.abort());
  await page.goto('/admin/login'); await page.getByLabel('E-mail').fill(identity.email); await page.getByLabel('Heslo').fill(identity.password);
  await page.getByRole('button', { name: 'Přihlásit se', exact: true }).click(); await page.locator('.admin-dashboard').waitFor();
  await page.goto('/admin/quizzes/' + id + '/edit'); await page.locator('.outline-question').nth(1).waitFor();
  return { identity, root };
}
const select = (page, index) => page.locator('.outline-question').nth(index).click();
const prompt = page => page.getByRole('textbox', { name: 'Otázka *', exact: true });
const save = page => page.getByRole('button', { name: 'Uložit vše', exact: true }).click();


async function storyboard(page) { await page.getByRole('button', { name: 'Storyboard', exact: true }).click(); }
const card = (page, id) => page.locator('.storyboard-card[data-slide-id="' + id + '"]');
const order = page => page.locator('.storyboard-card').evaluateAll(nodes => nodes.map(node => node.dataset.slideId));
async function secondRound(f) {
  const batch = f.identity.db.batch();
  for (const [i, key] of ['round2', 'c', 'd', 'recap2'].entries()) batch.set(f.root.collection('slides').doc(key), {
    ...mediaSlide(i === 1 || i === 2 ? 'free' : i === 0 ? 'round' : 'recap'), position: i + 5, roundId: 'round2', roundTitle: 'Druhé kolo',
    isQuestion: i === 1 || i === 2, title: i === 0 ? 'Druhé kolo' : '', text: key, correctAnswer: 'Private answer', authoringStatus: 'ready', answerMode: 'open'
  });
  batch.set(f.root.collection('rounds').doc('round2'), { title: 'Druhé kolo', position: 2, type: 'classic', questionCount: 2, slideCount: 4 });
  batch.update(f.root, { slideCount: 8, questionCount: 4, roundCount: 2 }); await batch.commit();
}

test('storyboard follows persisted order and retains working copy when selecting cards', async ({ page }) => {
  const f = await fixture(page);
  try {
    await select(page, 0); await prompt(page).fill('Working copy'); await storyboard(page);
    expect(await order(page)).toEqual(['round', 'a', 'b', 'recap']);
    await expect(card(page, 'a')).toContainText('Neuložené změny');
    await expect(card(page, 'a')).toContainText('Working copy');
    await expect(card(page, 'a').getByRole('button', { name: /Přetáhnout/ })).toBeDisabled();
    await expect(page.locator('.editor-storyboard iframe, .editor-storyboard video, .editor-storyboard audio')).toHaveCount(0);
    await card(page, 'b').getByRole('button', { name: /Upravit slide/ }).click();
    await prompt(page).fill('Other working copy'); await storyboard(page);
    await card(page, 'a').getByRole('button', { name: /Upravit slide/ }).click(); await expect(prompt(page)).toHaveValue('Working copy');
    await save(page); await expect(page.locator('.save-state')).toHaveText('Uloženo'); await storyboard(page);
    await expect(page.getByText('Neuložené změny', { exact: true })).toHaveCount(0);
    await page.screenshot({ path: '.local-data/editor-storyboard/desktop.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: '.local-data/editor-storyboard/mobile.png', fullPage: true });
  } finally { await f.identity.dispose(); }
});

test('keyboard controls and dragging move questions while preserving recap placement', async ({ page }) => {
  const f = await fixture(page);
  try {
    await secondRound(f); await page.reload(); await page.setViewportSize({ width: 1280, height: 1500 }); await storyboard(page);
    await card(page, 'a').getByRole('button', { name: 'Otázka 1 dolů' }).focus(); await page.keyboard.press('Enter');
    await expect.poll(() => order(page)).toEqual(['round','b','a','recap','round2','c','d','recap2']);
    await expect(card(page, 'a').getByRole('button', { name: /Přetáhnout/ })).toBeEnabled();
    await card(page, 'a').getByRole('button', { name: /Přetáhnout/ }).dragTo(card(page, 'c'));
    await expect.poll(() => order(page)).toEqual(['round','b','recap','round2','a','c','d','recap2']);
    expect((await f.root.collection('slides').doc('a').get()).data().roundId).toBe('round2');
    expect((await f.root.collection('slides').doc('a').get()).data().questionNumber).toBe(1);
    await card(page, 'a').getByRole('combobox').selectOption('round');
    await expect.poll(() => order(page)).toEqual(['round','b','a','recap','round2','c','d','recap2']);
    await expect(page.locator('.editor-storyboard [role="status"]')).toContainText('Otázka přesunuta');
  } finally { await f.identity.dispose(); }
});

test('interrupted multi-step move reloads acknowledged order and can continue safely', async ({ page }) => {
  const f = await fixture(page); let failed = false;
  try {
    await secondRound(f); await page.reload(); await page.setViewportSize({ width: 1280, height: 1500 }); await storyboard(page);
    await page.route('**/reorderQuizQuestion', async route => {
      if (route.request().method() === 'POST' && !failed) { failed = true; return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { status: 'UNAVAILABLE', message: 'Synthetic interruption' } }) }); }
      return route.continue();
    });
    await expect(card(page, 'a').getByRole('button', { name: /Přetáhnout/ })).toBeEnabled();
    await card(page, 'a').getByRole('button', { name: /Přetáhnout/ }).dragTo(card(page, 'c'));
    await expect(page.locator('.round-editor-error')).toContainText('Přesun nebyl dokončen');
    await expect.poll(() => order(page)).toEqual(['round','b','recap','round2','c','d','a','recap2']);
    await expect(card(page, 'a').getByRole('button', { name: /Přetáhnout/ })).toBeEnabled();
    await card(page, 'a').getByRole('button', { name: /Přetáhnout/ }).dragTo(card(page, 'c'));
    await expect.poll(() => order(page)).toEqual(['round','b','recap','round2','a','c','d','recap2']);
  } finally { await f.identity.dispose(); }
});



test('large storyboard mounts previews only near the viewport', async ({ page }) => {
  const f = await fixture(page);
  try {
    const question = (await f.root.collection('slides').doc('a').get()).data();
    const batch = f.identity.db.batch(); batch.delete(f.root.collection('slides').doc('a')); batch.delete(f.root.collection('slides').doc('b'));
    for (let i = 0; i < 180; i++) batch.set(f.root.collection('slides').doc('large-' + i), { ...question, position: i + 2, text: 'Otázka ' + (i + 1), questionNumber: i + 1 });
    batch.update(f.root.collection('slides').doc('recap'), { position: 182 }); batch.update(f.root, { slideCount: 182, questionCount: 180 }); await batch.commit();
    await page.reload(); await storyboard(page); await expect(page.locator('.storyboard-card')).toHaveCount(182);
    expect(await page.locator('.storyboard-thumbnail .preview-stage').count()).toBeLessThan(20);
    await card(page, 'large-179').scrollIntoViewIfNeeded(); await expect(card(page, 'large-179').locator('.preview-stage')).toBeVisible();
    expect(await page.locator('.storyboard-thumbnail .preview-stage').count()).toBeLessThan(20);
    await card(page, 'large-179').getByRole('button', { name: /Upravit slide/ }).click(); await expect(prompt(page)).toHaveValue('Otázka 180');
  } finally { await f.identity.dispose(); }
});
