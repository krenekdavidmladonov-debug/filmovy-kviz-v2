import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { chromium } from '@playwright/test';

const baseUrl = process.env.EVENT_NIGHT_BASE_URL ?? '';
const candidateManifestPath = process.env.EVENT_NIGHT_CANDIDATE_MANIFEST ?? '';
const outputPath = process.env.TONIGHT_REPAIR_CHECK_OUTPUT ?? '';
const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH;

function assertLocalUrl(value) {
  const parsed = new URL(value);
  if (parsed.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname) || parsed.port !== '5000') {
    throw new Error('Tonight repair check requires exact localhost Hosting Emulator port 5000.');
  }
}

function assertExpectedInitialLayout(issues) {
  const expectedChoice = Array.from({ length: 5 }, (_, roundIndex) => (
    Array.from({ length: 3 }, (_, questionIndex) => `${roundIndex + 1}:${questionIndex + 1}`)
  )).flat().sort();
  const actualChoice = issues.filter((issue) => issue.kind === 'choice-answer')
    .map((issue) => `${issue.round}:${issue.question}`).sort();
  const timing = issues.filter((issue) => issue.kind === 'video-timing');
  if (JSON.stringify(actualChoice) !== JSON.stringify(expectedChoice)
    || timing.length !== 1 || timing[0].round !== 2 || timing[0].question !== 8) {
    throw new Error('Initial candidate repair layout differs from the expected human-required sanity check.');
  }
}

async function main() {
  assertLocalUrl(baseUrl);
  if (!candidateManifestPath || !outputPath || !executablePath) {
    throw new Error('Tonight repair check is missing a candidate, output, or browser path.');
  }
  const manifest = JSON.parse(await readFile(candidateManifestPath, 'utf8'));
  if (manifest.projectId !== 'demo-filmovy-kviz-v2' || !manifest.candidate?.quizId || !manifest.candidate?.title) {
    throw new Error('Candidate manifest is not pinned to the demo project.');
  }
  const repairUrl = `${baseUrl}/admin/quizzes/${encodeURIComponent(manifest.candidate.quizId)}/readiness/repair`;
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const runtimeErrors = [];
    page.on('pageerror', (error) => runtimeErrors.push(error.message));
    await page.goto(repairUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForURL(/\/admin\/login$/u);
    await page.getByLabel('E-mail').fill('admin@example.test');
    await page.getByLabel('Heslo').fill('LocalQuiz123!');
    await page.getByRole('button', { name: 'Přihlásit se' }).click();
    await page.waitForURL(new RegExp(`/admin/quizzes/${manifest.candidate.quizId}/readiness/repair$`, 'u'));
    const shell = page.locator('.quiz-repair-page');
    await shell.waitFor({ state: 'visible' });
    const issues = await page.locator('[data-repair-issue-code]').evaluateAll((elements) => elements.map((element) => ({
      code: element.getAttribute('data-repair-issue-code'),
      round: Number(element.getAttribute('data-round-position')),
      question: Number(element.getAttribute('data-question-number')),
      kind: element.getAttribute('data-repair-kind'),
    })));
    const blockers = Number(await shell.getAttribute('data-blocker-count'));
    const warnings = Number(await shell.getAttribute('data-warning-count'));
    const status = await shell.getAttribute('data-repair-status');
    if (issues.length !== blockers) throw new Error('Repair queue count differs from authoritative preflight blockers.');
    if (blockers === 16) assertExpectedInitialLayout(issues);
    const firstChoiceVisible = issues[0]?.kind === 'choice-answer';
    const adminPrivateContextVisible = !firstChoiceVisible
      || await page.locator('.repair-original-answer').isVisible();
    const selectedOptions = await page.getByRole('radio').evaluateAll((radios) => radios.filter(
      (radio) => 'checked' in radio && radio.checked === true,
    ).length);
    if (!adminPrivateContextVisible || selectedOptions !== 0 || runtimeErrors.length !== 0) {
      throw new Error('Repair UI read-only audit failed.');
    }
    const report = {
      schemaVersion: 1,
      projectId: 'demo-filmovy-kviz-v2',
      checkedAtUtc: new Date().toISOString(),
      candidate: { quizId: manifest.candidate.quizId, title: manifest.candidate.title },
      readiness: { status, blockers, warnings },
      issues,
      adminPrivateContextVisible,
      noDefaultSelection: selectedOptions === 0,
      initialQueueLoadMs: Number(await shell.getAttribute('data-initial-load-ms')),
      runtimeErrorCount: runtimeErrors.length,
      containsQuestionText: false,
      containsOptionValues: false,
      containsCorrectAnswers: false,
      containsMediaUrls: false,
      containsLegacyRaw: false,
    };
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify({ status: 'PASS', blockers, warnings, output: '.local-data/tonight-repair/candidate-manifest.json' }));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
