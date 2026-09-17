import { expect, test, type Page } from '@playwright/test';

const diagnostics = new WeakMap<Page, { pageErrors: string[]; blockedRequests: string[] }>();
test.beforeEach(async ({ context, page }) => {
  const evidence = { pageErrors: [] as string[], blockedRequests: [] as string[] };
  diagnostics.set(page, evidence);
  page.on('pageerror', error => evidence.pageErrors.push(error.stack ?? error.message));
  // Only the existing local preview may serve this fixture; no Auth/API traffic escapes.
  await context.route('**/*', async route => {
    if (new URL(route.request().url()).origin === 'http://127.0.0.1:5188') await route.continue();
    else { evidence.blockedRequests.push(route.request().url()); await route.abort('blockedbyclient'); }
  });
  await context.routeWebSocket('**/*', socket => {
    if (new URL(socket.url()).origin === 'ws://127.0.0.1:5188') socket.connectToServer();
    else { evidence.blockedRequests.push(socket.url()); void socket.close(); }
  });
});
test.afterEach(async ({ page }, testInfo) => {
  const evidence = diagnostics.get(page)!;
  await testInfo.attach('runtime-and-network', { body: JSON.stringify({ ...evidence, viewport: page.viewportSize(), retry: testInfo.retry }, null, 2), contentType: 'application/json' });
  if (testInfo.status !== testInfo.expectedStatus) await testInfo.attach('failure-screen', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
  expect.soft(evidence.pageErrors, 'Unhandled browser errors').toEqual([]);
  expect.soft(evidence.blockedRequests, 'Unexpected traffic outside the isolated preview').toEqual([]);
});

test('create and edit preserve the form contract and revision', async ({ page }) => {
  await page.goto('/admin/events/new');
  await page.getByLabel('Název akce').fill('Syntetická nová akce');
  await page.getByLabel('Datum a čas').fill('2030-10-20T19:00');
  await page.getByLabel('Místo', { exact: true }).fill('Testovací sál');
  await page.getByLabel('Veřejné upřesnění místa').fill('Testovací lokalita');
  await page.getByRole('button', { name: 'Vytvořit akci', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Vytvářím…' })).toBeDisabled();
  await expect(page).toHaveURL(/synthetic-event$/u);
  await expect(page.getByLabel('Název akce')).toHaveValue('Syntetická nová akce');
  await page.getByLabel('Název akce').fill('Upravená akce');
  await page.getByRole('button', { name: 'Uložit změny' }).click();
  await expect(page.getByRole('status')).toHaveText('Změny akce byly uloženy.');
  const calls = await page.evaluate(() => window.uxCalls);
  expect(calls).toEqual([
    { operation: 'create', values: { title: 'Syntetická nová akce', startsAt: '2030-10-20T19:00', timeZone: 'Europe/Prague', venueName: 'Testovací sál', publicLocation: 'Testovací lokalita', teamCapacity: 20, peopleCapacity: 120, teamSizeMin: 2, teamSizeMax: 6 } },
    expect.objectContaining({ operation: 'update', id: 'synthetic-event', revision: 3, values: expect.objectContaining({ title: 'Upravená akce', teamCapacity: 20, peopleCapacity: 120 }) }),
  ]);
});

test('save errors retain values and native constraints prevent invalid submissions', async ({ page }) => {
  await page.goto('/admin/events/synthetic-event?fail=1');
  await page.getByLabel('Název akce').fill('Neztratit koncept');
  await page.getByLabel('Maximální počet týmů', { exact: true }).fill('0');
  await page.getByRole('button', { name: 'Uložit změny' }).click();
  expect(await page.evaluate(() => window.uxCalls.length)).toBe(0);
  await page.getByLabel('Maximální počet týmů', { exact: true }).fill('21');
  await page.getByRole('button', { name: 'Uložit změny' }).click();
  await expect(page.getByRole('alert')).toContainText('Změny se nepodařilo uložit');
  await expect(page.getByLabel('Název akce')).toHaveValue('Neztratit koncept');
  await expect(page.getByLabel('Maximální počet týmů', { exact: true })).toHaveValue('21');
  await expect(page.getByRole('status')).toHaveCount(0);
});

test('moderator stays read-only', async ({ page }) => {
  await page.goto('/admin/events/synthetic-event?role=moderator');
  await expect(page.getByRole('heading', { name: 'Detail akce' })).toBeVisible();
  await expect(page.locator('.event-form')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Uložit změny' })).toHaveCount(0);
  await page.goto('/admin/events/new?role=moderator');
  await expect(page.getByRole('heading', { name: 'Pouze pro administrátora' })).toBeVisible();
});

for (const [width, height] of [[1280, 720], [1024, 768], [390, 844]]) {
  test(`both forms visual contract ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width: width!, height: height! });
    for (const route of ['new', 'synthetic-event']) {
      await page.goto('/admin/events/' + route);
      const field = page.getByLabel('Název akce');
      await expect(field).toBeVisible();
      await expect(page.getByText('Testovací verze', { exact: true }).filter({ visible: true })).toBeVisible();
      const environmentNote = page.getByRole('main').getByRole('note');
      await expect(environmentNote).toHaveText('Pro zkoušení používejte pouze smyšlená data.');
      await expect(environmentNote).toBeVisible();
      const size = await field.boundingBox();
      expect(size!.height).toBe(46);
      expect(size!.width).toBeGreaterThan(width === 390 ? 250 : 600);
      expect(await page.locator('h1').evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeLessThanOrEqual(36);
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
      await field.focus();
      await page.keyboard.press('Tab');
      await expect(page.getByLabel('Datum a čas')).toBeFocused();
      await page.screenshot({ path: `.local-data/events-form-ux/after-local/${route}-${width}.png`, fullPage: true });
    }
  });
}
