import { expect, test, type Page } from '@playwright/test';

test.skip(process.env.MIGRATED_EDITOR_E2E !== '1', 'Runs only against the local migrated-data emulator fixture.');

async function login(page: Page, baseURL: string | undefined): Promise<void> {
  await page.goto(`${baseURL}/admin/login`);
  await page.getByLabel('E-mail').fill('admin@example.test');
  await page.getByLabel('Heslo').fill('LocalQuiz123!');
  await page.getByRole('button', { name: 'Přihlásit se' }).click();
  await expect(page).toHaveURL(/\/admin$/u);
}

test('all migrated quizzes produce a private, bounded and sanitised readiness result', async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await login(page, baseURL);
  await page.goto(`${baseURL}/admin/quizzes`);

  const quizLinks = page.locator('a.quiz-title-link');
  await expect(quizLinks).toHaveCount(4);
  const quizPaths = await quizLinks.evaluateAll((links) => links
    .map((link) => link.getAttribute('href'))
    .filter((href): href is string => href !== null));

  let roundCount = 0;
  let questionCount = 0;
  let blockerCount = 0;
  let warningCount = 0;
  let largestQuizQuestions = 0;
  let largestQuizValidationMs = 0;
  const issueCategories: Record<string, { blockers: number; warnings: number }> = {};

  for (const quizPath of quizPaths) {
    await page.goto(`${baseURL}${quizPath}/readiness`);
    const panel = page.locator('[data-preflight-status]');
    await expect(panel).toBeVisible();

    const currentQuestions = Number(await panel.getAttribute('data-question-count'));
    roundCount += Number(await panel.getAttribute('data-round-count'));
    questionCount += currentQuestions;
    blockerCount += Number(await panel.getAttribute('data-blocker-count'));
    warningCount += Number(await panel.getAttribute('data-warning-count'));
    if (currentQuestions > largestQuizQuestions) {
      largestQuizQuestions = currentQuestions;
      largestQuizValidationMs = Number(await panel.getAttribute('data-validation-duration-ms'));
    }

    for (const category of await panel.locator('[data-category]').evaluateAll((items) => items.map((item) => ({
      name: item.getAttribute('data-category'),
      blockers: Number(item.getAttribute('data-category-blockers')),
      warnings: Number(item.getAttribute('data-category-warnings')),
    })))) {
      if (category.name === null) continue;
      const current = issueCategories[category.name] ?? { blockers: 0, warnings: 0 };
      issueCategories[category.name] = {
        blockers: current.blockers + category.blockers,
        warnings: current.warnings + category.warnings,
      };
    }

    await expect(panel.locator('[data-legacy-raw]')).toHaveCount(0);
    await expect(panel.locator('[data-correct-answer]')).toHaveCount(0);
    await expect(panel.locator('[data-media-source]')).toHaveCount(0);
  }

  expect(roundCount).toBe(23);
  expect(questionCount).toBe(263);
  expect(largestQuizValidationMs).toBeLessThan(50);

  console.info(JSON.stringify({
    status: 'PASS',
    quizzesChecked: quizPaths.length,
    roundCount,
    questionCount,
    blockerCount,
    warningCount,
    issueCategories,
    largestQuizQuestions,
    largestQuizValidationMs,
  }));
});
