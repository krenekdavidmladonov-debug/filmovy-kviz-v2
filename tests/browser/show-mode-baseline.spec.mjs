/* global window, document, requestAnimationFrame, MutationObserver */
import { expect, test } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { leaderboardFixture } from '../e2e/leaderboard-fixture.mjs';

const baselineURL = 'http://127.0.0.1:5209', currentURL = 'http://127.0.0.1:5208';
const evidence = '.local-data/show-mode-baseline/evidence';
const panel = page => page.getByRole('region', { name: 'Ovládání průběžných výsledků', exact: true });
const summary = values => {
  const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
  return { n: values.length, median: sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2,
    p95: sorted[Math.ceil(sorted.length * .95) - 1], max: sorted.at(-1) };
};
async function localOnly(context) { await context.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort()); }
async function login(page, fixture) {
  await page.goto('/admin/login'); await page.getByLabel('E-mail').fill(fixture.login.email); await page.getByLabel('Heslo').fill(fixture.login.password);
  await page.getByRole('button', { name: 'Přihlásit se', exact: true }).click(); await expect(page).toHaveURL(/\/admin$/u);
  await page.goto('/admin/live/' + fixture.sessionId); await expect(page.locator('.live-control')).toBeVisible();
}
async function install(admin, projector) {
  await admin.evaluate(() => {
    window.__baselineCommand = null;
    const nativeFetch = window.fetch.bind(window);
    window.fetch = (...args) => {
      const url = String(args[0] instanceof Request ? args[0].url : args[0]);
      if (url.endsWith('/nextSlide') || url.endsWith('/controlInterimResults')) {
        try {
          const body = JSON.parse(String(args[1]?.body)).data;
          if (url.endsWith('/nextSlide') || body?.action === 'publish') window.__baselineCommand = performance.timeOrigin + performance.now();
        } catch { /* Non-command requests are not timed. */ }
      }
      return nativeFetch(...args);
    };
  });
  await projector.evaluate(() => {
    window.__baselinePerf = { armed: false, kind: '', expected: '', domEpoch: null, frames: [], longTasks: [] };
    let previous = performance.now();
    const frame = now => { if (window.__baselinePerf.armed) window.__baselinePerf.frames.push(now - previous); previous = now; requestAnimationFrame(frame); }; requestAnimationFrame(frame);
    new PerformanceObserver(list => { if (window.__baselinePerf.armed) window.__baselinePerf.longTasks.push(...list.getEntries().map(entry => entry.duration)); }).observe({ type: 'longtask', buffered: false });
    new MutationObserver(() => {
      const measured = window.__baselinePerf;
      if (!measured.armed || measured.domEpoch !== null) return;
      const ready = measured.kind === 'publish' ? document.querySelectorAll('.results-canvas tbody tr').length === 6
        : [...document.querySelectorAll('.slide-renderer')].some(element => element.textContent.includes(measured.expected));
      if (ready) measured.domEpoch = performance.timeOrigin + performance.now();
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  });
}
async function publish(admin) {
  await panel(admin).getByLabel('Výsledky po kole').selectOption('r2');
  await panel(admin).getByRole('button', { name: 'Načíst náhled výsledků', exact: true }).click();
  await expect(panel(admin).getByRole('heading', { name: 'Interní náhled — zatím nezveřejněno', exact: true })).toBeVisible();
}
test('actual archived frontend before/after at 6× CPU: Next and classic publication on identical data', async ({ browser }, testInfo) => {
  const fixture = await leaderboardFixture(6), contexts = [];
  await mkdir(evidence, { recursive: true });
  const provenance = JSON.parse(await readFile('.local-data/show-mode-baseline/build.json', 'utf8'));
  const report = { status: 'MEASURED', baseline: provenance, current: 'working tree codex/show-mode-implementation', browser: browser.version(), cpuThrottle: 6, viewport: '1920x1080', backend: 'Same current demo emulator Functions for both frontend bundles; not a historical backend reproduction.', method: 'One shared six-team event/session and scores. Archived source 9404e1c and archived quiz-domain alias versus current production bundle. Only projector is CPU-throttled. Both paths use classic results with identical public protocol and rows; no response interception. Next moves classic question 3 to classic question 4, avoiding audio player initialization/lifecycle callbacks. Warm-up then four alternating baseline/current samples each for Next and publish. Epoch-aligned actual fetch start to DOM mutation, followed by 600ms RAF and Long Task observation. The earlier 2-to-3 audio-origin run is retained separately as before-after-audio-origin.json.', samples: { baseline: { next: [], publish: [] }, current: { next: [], publish: [] } } };
  try {
    const clients = {};
    for (const [variant, baseURL] of [['baseline', baselineURL], ['current', currentURL]]) {
      const adminContext = await browser.newContext({ baseURL, viewport: { width: 1920, height: 1080 } }); contexts.push(adminContext); await localOnly(adminContext);
      const admin = await adminContext.newPage(); await login(admin, fixture);
      const projectorContext = await browser.newContext({ baseURL, viewport: { width: 1920, height: 1080 } }); contexts.push(projectorContext); await localOnly(projectorContext);
      const projector = await projectorContext.newPage(); const errors = [];
      projector.on('pageerror', error => errors.push(error.message)); admin.on('pageerror', error => errors.push(error.message));
      await projector.goto('/projector/' + fixture.sessionId); await expect(projector.locator('.slide-renderer')).toBeVisible();
      const cdp = await projectorContext.newCDPSession(projector); await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 });
      await install(admin, projector); clients[variant] = { admin, projector, errors };
    }
    let expectedRows;
    for (let iteration = -1; iteration < 4; iteration++) {
      for (const variant of iteration % 2 === 0 ? ['current', 'baseline'] : ['baseline', 'current']) {
        const { admin, projector } = clients[variant];
        // Both endpoints of Next 3→4 are classic questions with distinct titles.
        await fixture.call('goToSlide', { sessionId: fixture.sessionId, expectedRevision: (await fixture.session()).revision, position: 3 });
        await expect(admin.locator('.live-control')).toHaveAttribute('data-current-position', '3');
        await expect(projector.locator('.slide-renderer')).toContainText('Synthetic question 3');
        for (const kind of ['next', 'publish']) {
          if (kind === 'publish') await publish(admin);
          await projector.evaluate(kind => Object.assign(window.__baselinePerf, { armed: true, kind, expected: 'Synthetic question 4', domEpoch: null, frames: [], longTasks: [] }), kind);
          if (kind === 'next') await admin.getByRole('button', { name: 'Další →', exact: true }).click();
          else await panel(admin).getByRole('button', { name: /^(Zobrazit výsledky|Aktualizovat zobrazené výsledky)$/u }).click();
          await expect.poll(() => projector.evaluate(() => window.__baselinePerf.domEpoch)).not.toBeNull();
          await projector.waitForTimeout(600);
          const measured = await projector.evaluate(() => { window.__baselinePerf.armed = false; return { ...window.__baselinePerf }; });
          const started = await admin.evaluate(() => window.__baselineCommand); expect(started).not.toBeNull();
          const sample = { iteration, commandToDomMs: measured.domEpoch - started, rafGapMs: summary(measured.frames), longTasksMs: measured.longTasks, longTaskTotalMs: measured.longTasks.reduce((sum, value) => sum + value, 0) };
          expect(sample.commandToDomMs).toBeGreaterThanOrEqual(0);
          if (kind === 'publish') {
            const raw = await fixture.publicState();
            expect(raw.interimResults.presentationStyle).toBeUndefined(); expect(raw.interimResults.pageSize).toBeUndefined();
            if (!expectedRows) expectedRows = raw.interimResults.rows;
            expect(raw.interimResults.rows).toEqual(expectedRows);
            if (iteration === 0) await projector.screenshot({ path: `${evidence}/${variant}-classic.png` });
          }
          if (iteration >= 0) report.samples[variant][kind].push(sample);
        }
        await panel(admin).getByRole('button', { name: /^(Skrýt výsledky|Skrýt výsledky a vrátit prezentaci)$/u }).click();
        await expect(projector.locator('.slide-renderer')).toBeVisible();
      }
    }
    for (const client of Object.values(clients)) expect(client.errors).toEqual([]);
    report.summary = Object.fromEntries(Object.entries(report.samples).map(([variant, flows]) => [variant, Object.fromEntries(Object.entries(flows).map(([kind, samples]) => [kind, { commandToDomMs: summary(samples.map(sample => sample.commandToDomMs)), rafP95Ms: summary(samples.map(sample => sample.rafGapMs.p95)), longTaskTotalMs: samples.reduce((sum, sample) => sum + sample.longTaskTotalMs, 0) }]))]));
    report.deltaCurrentMinusBaselineMs = Object.fromEntries(['next', 'publish'].map(kind => [kind, report.summary.current[kind].commandToDomMs.median - report.summary.baseline[kind].commandToDomMs.median]));
    await writeFile(evidence + '/before-after.json', JSON.stringify(report, null, 2));
    await testInfo.attach('actual-frontend-before-after', { body: JSON.stringify(report, null, 2), contentType: 'application/json' });
  } finally { for (const context of contexts) await context.close(); await fixture.close(); }
});
