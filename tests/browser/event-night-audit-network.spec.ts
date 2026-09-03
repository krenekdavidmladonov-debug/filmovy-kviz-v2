import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { expect, test } from '@playwright/test';

test.skip(process.env.EVENT_NIGHT_AUDIT_NETWORK !== '1', 'Runs only in the isolated background event-night audit.');

test('projector clears stale state offline and recovers after an explicit reconnect', async ({ browser, baseURL }) => {
  const context = await browser.newContext();
  await context.route('https://example.test/**', async (route) => route.abort('failed'));
  const moderator = await context.newPage();
  await moderator.goto(`${baseURL}/admin/login`);
  await moderator.getByLabel('E-mail').fill('admin@example.test');
  await moderator.getByLabel('Heslo').fill('LocalQuiz123!');
  await moderator.getByRole('button', { name: 'Přihlásit se' }).click();
  await expect(moderator).toHaveURL(/\/admin$/u);

  await moderator.goto(`${baseURL}/admin/quizzes/projector-lifecycle-e2e`);
  await moderator.getByRole('link', { name: 'Spustit kvíz' }).click();
  await moderator.getByRole('button', { name: 'Spustit i tak' }).click();
  await moderator.getByRole('button', { name: 'Potvrdit a spustit' }).click();
  await expect(moderator).toHaveURL(/\/admin\/live\/[^/]+$/u);
  const sessionId = new URL(moderator.url()).pathname.split('/').at(-1);
  expect(sessionId).toBeTruthy();

  const projector = await context.newPage();
  await projector.goto(`${baseURL}/projector/${sessionId}`);
  await expect(projector.getByText('Čekáme na první slide')).toBeVisible();
  await moderator.getByRole('button', { name: 'Další →' }).click();
  await expect(projector.getByText('Začínáme', { exact: true })).toBeVisible();

  await context.setOffline(true);
  await expect(projector.getByRole('heading', { name: 'Projektor není připojen' })).toBeVisible();
  await expect(projector.getByText('Začínáme', { exact: true })).toHaveCount(0);
  await expect(projector.locator('.slide-answer')).toHaveCount(0);
  const offlineText = await projector.locator('article').innerText();
  const offlineCopy = offlineText.includes('z bezpečnostních důvodů nezobrazuje uložený stav')
    ? 'SAFETY_EXPLANATION_VISIBLE'
    : offlineText.includes('Spojení s projektorem se nezdařilo')
      ? 'GENERIC_CONNECTION_ERROR_VISIBLE'
      : 'UNEXPECTED_COPY';
  expect(offlineCopy).not.toBe('UNEXPECTED_COPY');

  await context.setOffline(false);
  await projector.reload();
  await expect(projector.getByText('Začínáme', { exact: true })).toBeVisible();
  await projector.evaluate(() => {
    Object.defineProperty(document.documentElement, 'requestFullscreen', {
      configurable: true,
      value: () => Promise.reject(new Error('synthetic fullscreen rejection')),
    });
  });
  await projector.getByRole('button', { name: /Celá obrazovka/iu }).click();
  await expect(projector.getByText('Celá obrazovka se nepodařila spustit. Použijte fullscreen prohlížeče.')).toBeVisible();

  for (let step = 0; step < 3; step += 1) {
    await moderator.getByRole('button', { name: 'Další →' }).click();
  }
  await expect(projector.getByText('Syntetická obrázková otázka', { exact: true })).toBeVisible();
  const syntheticImage = projector.locator('.question-image-frame img');
  await expect(syntheticImage).toBeVisible();
  await expect.poll(() => syntheticImage.evaluate((image) => (image as HTMLImageElement).complete)).toBe(true);
  const syntheticImageFallback = await syntheticImage.evaluate((image) => (
    (image as HTMLImageElement).naturalWidth === 0 ? 'MISSING' : 'NOT_NEEDED'
  ));

  await projector.close();
  const reopened = await context.newPage();
  await reopened.goto(`${baseURL}/projector/${sessionId}`);
  await expect(reopened.getByText('Syntetická obrázková otázka', { exact: true })).toBeVisible();
  await expect(reopened.locator('.slide-answer')).toHaveCount(0);
  const resultPath = path.resolve('.local-data/background-event-night-audit/network-browser-observation.json');
  await mkdir(path.dirname(resultPath), { recursive: true });
  await writeFile(resultPath, `${JSON.stringify({ offlineCopy, syntheticImageFallback }, null, 2)}\n`, 'utf8');
  await context.close();
});
