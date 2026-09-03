import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { expect, test, type Page } from '@playwright/test';

test.skip(process.env.TOMORROW_CANDIDATE_E2E !== '1', 'Runs only against the local migrated event-night candidate.');

async function login(page: Page, baseURL: string | undefined): Promise<void> {
  await page.goto(`${baseURL}/admin/login`);
  await page.getByLabel('E-mail').fill('admin@example.test');
  await page.getByLabel('Heslo').fill('LocalQuiz123!');
  await page.getByRole('button', { name: 'Přihlásit se' }).click();
  await expect(page).toHaveURL(/\/admin$/u);
}

test('candidate opens every round and question forward and backward without stale UI', async ({ page, baseURL }) => {
  const manifest = JSON.parse(await readFile(
    path.resolve('.local-data/tomorrow-candidate/candidate-manifest.json'),
    'utf8',
  )) as { candidate: { quizId: string; rounds: number; questions: number; blockers: number } };
  const runtimeErrors: string[] = [];
  page.on('pageerror', (error) => runtimeErrors.push(error.message));
  await login(page, baseURL);
  await page.goto(`${baseURL}/admin/quizzes/${encodeURIComponent(manifest.candidate.quizId)}/edit`);
  await expect(page.locator('.round-first-editor')).toBeVisible();
  const rounds = page.locator('.outline-round');
  await expect(rounds).toHaveCount(manifest.candidate.rounds);

  for (let roundIndex = 0; roundIndex < manifest.candidate.rounds; roundIndex += 1) {
    const numbers = await rounds.nth(roundIndex).locator('.outline-question-number').allTextContents();
    expect(numbers.map(Number)).toEqual(numbers.map((_, index) => index + 1));
  }
  const questions = page.locator('.outline-question');
  await expect(questions).toHaveCount(manifest.candidate.questions);
  let peakPlayerHosts = 0;
  for (let index = 0; index < manifest.candidate.questions; index += 1) {
    await questions.nth(index).click();
    await expect(questions.nth(index)).toHaveClass(/selected/u);
    await expect(page.locator('.question-form')).toBeVisible();
    const playerHosts = await page.locator('.youtube-player-shell').count();
    peakPlayerHosts = Math.max(peakPlayerHosts, playerHosts);
    expect(playerHosts).toBeLessThanOrEqual(1);
    await expect(page.locator('.slide-answer')).toHaveCount(0);
  }
  for (let index = manifest.candidate.questions - 1; index >= 0; index -= 1) {
    await questions.nth(index).click();
    await expect(questions.nth(index)).toHaveClass(/selected/u);
    await expect(page.locator('.question-form')).toBeVisible();
  }
  await questions.first().click();
  await expect(page.locator('.youtube-player-shell')).toHaveCount(0);
  const playerDiagnostics = await page.evaluate(() => window.__FILMOVY_KVIZ_MEDIA_DEBUG__);
  expect(peakPlayerHosts).toBe(1);
  expect(playerDiagnostics?.activePlayers ?? 0).toBe(0);
  expect(playerDiagnostics?.peakPlayers ?? 0).toBeLessThanOrEqual(1);
  expect(playerDiagnostics?.createdPlayers ?? 0).toBe(playerDiagnostics?.destroyedPlayers ?? 0);

  await page.goto(`${baseURL}/admin/quizzes/${encodeURIComponent(manifest.candidate.quizId)}/readiness`);
  const readiness = page.locator('[data-preflight-status]');
  await expect(readiness).toHaveAttribute('data-blocker-count', String(manifest.candidate.blockers));
  await expect(page.getByRole('button', { name: 'Kvíz nelze spustit' })).toBeDisabled();
  expect(runtimeErrors).toEqual([]);
});
