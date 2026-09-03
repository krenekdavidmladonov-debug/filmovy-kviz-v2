import { expect, test, type Page } from '@playwright/test';

test.skip(process.env.MIGRATED_EDITOR_E2E !== '1', 'Runs only against the local migrated-data emulator fixture.');

async function login(page: Page, baseURL: string | undefined): Promise<void> {
  await page.goto(`${baseURL}/admin/login`);
  await page.getByLabel('E-mail').fill('admin@example.test');
  await page.getByLabel('Heslo').fill('LocalQuiz123!');
  await page.getByRole('button', { name: 'Přihlásit se' }).click();
  await expect(page).toHaveURL(/\/admin$/u);
}

test('all migrated quizzes open through the round-first editor facade', async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await login(page, baseURL);
  await page.goto(`${baseURL}/admin/quizzes`);

  const quizLinks = page.locator('a.quiz-title-link');
  await expect(quizLinks).toHaveCount(4);
  const quizPaths = await quizLinks.evaluateAll((links) => links.map((link) => link.getAttribute('href')).filter((href): href is string => href !== null));

  let totalRounds = 0;
  let totalQuestions = 0;
  let totalLegacyPl = 0;
  let largestQuizPath = '';
  let largestQuestionCount = 0;

  for (const quizPath of quizPaths) {
    await page.goto(`${baseURL}${quizPath}`);
    await page.getByRole('link', { name: 'Otevřít editor' }).click();
    await expect(page.locator('.round-first-editor')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Základní údaje' })).toBeVisible();

    const roundCount = await page.locator('.outline-round').count();
    const questionCount = await page.locator('.outline-question').count();
    totalRounds += roundCount;
    totalQuestions += questionCount;
    totalLegacyPl += await page.locator('.outline-question').filter({ hasText: 'Pravda / Lež' }).count();
    if (questionCount > largestQuestionCount) {
      largestQuestionCount = questionCount;
      largestQuizPath = quizPath;
    }
  }

  expect(totalRounds).toBe(23);
  expect(totalQuestions).toBe(263);
  expect(totalLegacyPl).toBe(11);

  await page.goto(`${baseURL}${largestQuizPath}/edit`);
  const questions = page.locator('.outline-question');
  const switchStarted = Date.now();
  for (let index = 0; index < 5; index += 1) {
    await questions.first().click();
    await expect(page.locator('.question-form')).toBeVisible();
    await questions.last().click();
    await expect(page.locator('.question-form')).toBeVisible();
  }
  expect(Date.now() - switchStarted).toBeLessThan(10_000);
});
