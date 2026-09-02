import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { chromium } from '@playwright/test';

const baseUrl = process.env.EVENT_NIGHT_BASE_URL ?? '';
const candidateManifestPath = process.env.EVENT_NIGHT_CANDIDATE_MANIFEST ?? '';
const outputPath = process.env.EVENT_NIGHT_HEALTH_OUTPUT ?? '';
const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH;

function assertLocalUrl(value) {
  const parsed = new URL(value);
  if (parsed.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname) || parsed.port !== '5000') {
    throw new Error('Event-night health check requires exact localhost Hosting Emulator port 5000.');
  }
}

async function main() {
  assertLocalUrl(baseUrl);
  if (!candidateManifestPath || !outputPath || !executablePath) {
    throw new Error('Event-night health check is missing a candidate, output, or browser path.');
  }
  const manifest = JSON.parse(await readFile(candidateManifestPath, 'utf8'));
  if (manifest.projectId !== 'demo-filmovy-kviz-v2' || !manifest.candidate?.quizId) {
    throw new Error('Candidate manifest is not pinned to the demo project.');
  }

  const browser = await chromium.launch({ executablePath, headless: true });
  const runtimeErrors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    page.on('pageerror', (error) => runtimeErrors.push(error.message));
    await page.goto(`${baseUrl}/admin/login`, { waitUntil: 'domcontentloaded' });
    await page.getByLabel('E-mail').fill('admin@example.test');
    await page.getByLabel('Heslo').fill('LocalQuiz123!');
    await page.getByRole('button', { name: 'Přihlásit se' }).click();
    await page.waitForURL(/\/admin$/u);
    await page.goto(`${baseUrl}/admin/quizzes/${encodeURIComponent(manifest.candidate.quizId)}/readiness`);
    const panel = page.locator('[data-preflight-status]');
    await panel.waitFor({ state: 'visible' });

    const health = {
      schemaVersion: 1,
      projectId: 'demo-filmovy-kviz-v2',
      checkedAtUtc: new Date().toISOString(),
      baseUrl,
      candidateQuizId: manifest.candidate.quizId,
      candidateTitle: manifest.candidate.title,
      auth: 'PASS',
      candidateExists: true,
      readiness: {
        status: await panel.getAttribute('data-preflight-status'),
        rounds: Number(await panel.getAttribute('data-round-count')),
        questions: Number(await panel.getAttribute('data-question-count')),
        blockers: Number(await panel.getAttribute('data-blocker-count')),
        warnings: Number(await panel.getAttribute('data-warning-count')),
      },
      privateAnswerMarkers: await panel.locator('[data-correct-answer]').count(),
      privateMediaMarkers: await panel.locator('[data-media-source]').count(),
      legacyRawMarkers: await panel.locator('[data-legacy-raw]').count(),
      runtimeErrorCount: runtimeErrors.length,
    };
    if (health.readiness.rounds !== manifest.candidate.rounds || health.readiness.questions !== manifest.candidate.questions) {
      throw new Error('Candidate structure differs from the prepared candidate manifest.');
    }
    if (health.privateAnswerMarkers !== 0 || health.privateMediaMarkers !== 0 || health.legacyRawMarkers !== 0) {
      throw new Error('Readiness page exposed a private-field marker.');
    }
    if (runtimeErrors.length !== 0) throw new Error('Browser runtime errors occurred during health check.');
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(health, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify({ status: 'PASS', readiness: health.readiness, output: '.local-data/event-night/health.json' }));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
