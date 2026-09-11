import { expect, test } from '@playwright/test';

test('A: current staging client retains library, normal save/reload and original sentinel validation', async ({ page }) => {
  await page.context().route('**/*', async route => {
    if (['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname)) await route.continue();
    else await route.abort();
  });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/admin/login');
  await page.getByLabel('E-mail').fill('admin@example.test');
  await page.getByLabel('Heslo').fill('LocalQuiz123!');
  await page.getByRole('button', { name: 'Přihlásit se' }).click();
  await expect(page).toHaveURL(/\/admin$/u);
  await page.goto('/admin/quizzes');
  await expect(page.getByRole('link', { name: '+ Nový kvíz' })).toHaveCount(0);
  await page.goto('/admin/quizzes/preflight-ready-e2e/edit');
  await page.locator('.outline-question').click();
  const prompt = page.getByLabel('Otázka *');
  const text = 'Staging client compatibility save';
  await prompt.fill(text);
  await page.getByRole('button', { name: 'Uložit', exact: true }).click();
  await expect(page.locator('.save-state')).toHaveText('Uloženo');
  await page.reload();
  await page.locator('.outline-question').click();
  await expect(prompt).toHaveValue(text);
  await page.goto('/admin/quizzes/editor-core-imported-e2e/edit');
  await page.locator('.outline-question').click();
  await prompt.fill('Original client still blocks legacy timing');
  await page.getByRole('button', { name: 'Uložit', exact: true }).click();
  await expect(page.locator('.round-editor-error')).toContainText('Před uložením opravte označené údaje.');
  await expect(prompt).toHaveValue('Original client still blocks legacy timing');
  expect(errors).toEqual([]);
});
