import { expect, test, type Page } from '@playwright/test';

async function login(page: Page, baseURL: string | undefined, user = 'admin'): Promise<void> {
  await page.goto(`${baseURL}/admin/login`);
  await page.getByLabel('E-mail').fill(`${user}@example.test`);
  await page.getByLabel('Heslo').fill('LocalQuiz123!');
  await page.getByRole('button', { name: 'Přihlásit se' }).click();
}

test('admin explicitly repairs Choice then Video and reaches zero blockers after authoritative reloads', async ({ page, baseURL }) => {
  await login(page, baseURL);
  await expect(page).toHaveURL(/\/admin$/u);
  await page.goto(`${baseURL}/admin/quizzes/preflight-repair-flow-e2e/readiness`);
  await expect(page.locator('[data-preflight-status="BLOCKED"]')).toHaveAttribute('data-blocker-count', '2');
  await page.getByRole('link', { name: 'Opravit blokující problémy' }).click();
  await expect(page).toHaveURL(/\/admin\/quizzes\/preflight-repair-flow-e2e\/readiness\/repair$/u);

  for (const viewport of [
    { width: 1280, height: 720 },
    { width: 1024, height: 768 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(page.getByRole('heading', { name: 'Správná možnost není jednoznačně určená' })).toBeVisible();
    await expect(page.getByText('2 problémů zbývá')).toBeVisible();
  }
  await page.setViewportSize({ width: 1280, height: 720 });

  await expect(page.getByText('Původní odpověď z V1')).toBeVisible();
  await expect(page.getByText('Historická syntetická hodnota')).toBeVisible();
  const options = page.getByRole('radio');
  await expect(options).toHaveCount(5);
  for (let index = 0; index < 5; index += 1) await expect(options.nth(index)).not.toBeChecked();
  await expect(page.getByRole('button', { name: 'Uložit a pokračovat' })).toBeDisabled();
  await page.keyboard.press('B');
  await expect(options.nth(1)).toBeChecked();
  await page.getByRole('button', { name: 'Uložit a pokračovat' }).click();

  await expect(page.getByRole('heading', { name: 'Video nemá platný začátek a konec' })).toBeVisible();
  await expect(page.locator('.quiz-repair-page')).toHaveAttribute('data-blocker-count', '1');
  await page.getByLabel('START *').fill('0:05');
  await page.getByLabel('END *').fill('0:15.5');
  await expect(page.getByText('Délka klipu:').locator('strong')).toHaveText('0:10.5');
  await page.getByRole('button', { name: 'Uložit a pokračovat' }).click();

  await expect(page.getByRole('heading', { name: 'Technická obsahová kontrola dokončena.' })).toBeVisible();
  await expect(page.locator('.quiz-repair-page')).toHaveAttribute('data-blocker-count', '0');
  await expect(page.locator('.quiz-repair-page')).toHaveAttribute('data-warning-count', '1');
  await expect(page.getByText(/YouTube, HDMI ani fyzický zvuk tímto nejsou garantované/u)).toBeVisible();
  expect(page.url()).not.toContain('Historick');
});

test('moderator can inspect repair context but cannot select or save', async ({ page, baseURL }) => {
  await login(page, baseURL, 'moderator');
  await expect(page).toHaveURL(/\/admin$/u);
  await page.goto(`${baseURL}/admin/quizzes/preflight-repair-readonly-e2e/readiness/repair`);
  await expect(page.getByText('Pouze pro čtení — moderátor')).toBeVisible();
  await expect(page.getByText('Původní odpověď z V1')).toBeVisible();
  await expect(page.getByRole('radio').first()).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Uložit a pokračovat' })).toBeDisabled();
});

test('anonymous and ordinary authenticated users cannot open the repair route', async ({ page, baseURL }) => {
  await page.goto(`${baseURL}/admin/quizzes/preflight-repair-readonly-e2e/readiness/repair`);
  await expect(page).toHaveURL(/\/admin\/login$/u);
  await login(page, baseURL, 'user');
  await expect(page).toHaveURL(/\/admin\/no-access$/u);
});
