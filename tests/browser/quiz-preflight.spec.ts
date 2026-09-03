import { expect, test, type Page, type TestInfo } from '@playwright/test';

async function login(page: Page, baseURL: string | undefined): Promise<void> {
  await page.goto(`${baseURL}/admin/login`);
  await page.getByLabel('E-mail').fill('admin@example.test');
  await page.getByLabel('Heslo').fill('LocalQuiz123!');
  await page.getByRole('button', { name: 'Přihlásit se' }).click();
  await expect(page).toHaveURL(/\/admin$/u);
}

test('detail preflight blocks invalid quiz and deep-links to the exact editor field', async ({ page, baseURL }) => {
  await login(page, baseURL);
  await page.goto(`${baseURL}/admin/quizzes/preflight-blocked-e2e`);
  await page.getByRole('link', { name: 'Zkontrolovat připravenost' }).click();
  await expect(page).toHaveURL(/\/admin\/quizzes\/preflight-blocked-e2e\/readiness$/u);
  await expect(page.locator('[data-preflight-status="BLOCKED"]')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Kvíz nelze spustit' })).toBeDisabled();
  await expect(page.getByText('Kvíz zatím nelze spustit.', { exact: true })).toBeVisible();

  const promptIssue = page.locator('[data-issue-code="QUESTION_PROMPT_MISSING"]');
  await expect(promptIssue).toContainText('Výběr z možností · 1. kolo · Otázka 1');
  await expect(promptIssue).toContainText('Chybí zadání otázky.');
  await promptIssue.getByRole('link', { name: 'Opravit' }).click();
  await expect(page).toHaveURL(/\/edit\?.*questionId=slide-002.*field=prompt/u);
  await expect(page.getByLabel('Otázka *')).toBeFocused();
});

test('warning-only quiz requires confirmation before live start', async ({ page, baseURL }) => {
  await login(page, baseURL);
  await page.goto(`${baseURL}/admin/quizzes/preflight-warning-e2e/readiness`);
  await expect(page.locator('[data-preflight-status="READY_WITH_WARNINGS"]')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Spustit i tak' })).toBeVisible();
  await page.getByRole('button', { name: 'Spustit i tak' }).click();
  const confirmation = page.getByRole('alertdialog');
  await expect(confirmation).toContainText('Externí média nejsou garantovaná.');
  await confirmation.getByRole('button', { name: 'Potvrdit a spustit' }).click();
  await expect(page).toHaveURL(/\/admin\/live\/[^/]+$/u);
});

test('ready quiz starts normally after a fresh recheck', async ({ page, baseURL }) => {
  await login(page, baseURL);
  await page.goto(`${baseURL}/admin/quizzes/preflight-ready-e2e/readiness`);
  await expect(page.locator('[data-preflight-status="READY"]')).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Spuštění kvízu' }).getByText('Kvíz je připraven.', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Spustit kvíz' }).click();
  await expect(page).toHaveURL(/\/admin\/live\/[^/]+$/u);
});

test('editor preflight validates the local dirty draft and focuses its fix', async ({ page, baseURL }) => {
  await login(page, baseURL);
  await page.goto(`${baseURL}/admin/quizzes/preflight-ready-e2e/edit`);
  await page.locator('.outline-question').first().click();
  await page.getByLabel('Správná odpověď *').fill('');
  await expect(page.getByText('Neuložené změny', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Připravenost' }).click();
  const panel = page.locator('.editor-preflight-shell');
  await expect(panel.locator('[data-preflight-status="BLOCKED"]')).toBeVisible();
  await expect(panel).toContainText('aktuální lokální draft');
  await expect(panel).toContainText('Nejdříve uložte změny v editoru.');
  await panel.locator('[data-issue-code="ANSWER_MISSING"]').getByRole('button', { name: 'Opravit' }).click();
  await expect(page.getByLabel('Správná odpověď *')).toBeFocused();
});

test('readiness remains usable at desktop, tablet and mobile widths', async ({ browser, baseURL }, testInfo: TestInfo) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  await login(page, baseURL);
  await page.goto(`${baseURL}/admin/quizzes/preflight-warning-e2e/readiness`);
  for (const viewport of [
    { width: 1280, height: 720 },
    { width: 1024, height: 768 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(page.getByRole('heading', { name: 'Je tento kvíz připravený?' })).toBeVisible();
    await expect(page.locator('.preflight-status-grid')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Spustit i tak' })).toBeVisible();
    await testInfo.attach(`quiz-preflight-${viewport.width}x${viewport.height}`, {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });
  }
  await context.close();
});
