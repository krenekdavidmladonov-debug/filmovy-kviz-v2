/* global document, window, MutationObserver, requestAnimationFrame */
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { cpus, platform, release } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const out = path.join(root, '.local-data/show-mode-review');
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ executablePath: path.join(root, '.tools/playwright/chromium-1234/chrome-win64/chrome.exe'), headless: true });
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
const errors = [], nonlocal = [], checks = [], samples = [];
await context.route('**/*', route => {
  const url = new URL(route.request().url());
  if (url.hostname === '127.0.0.1' && url.port === '5216') return route.continue();
  nonlocal.push(url.origin); return route.abort();
});
const page = await context.newPage();
page.on('pageerror', error => errors.push(error.message));
const url = 'http://127.0.0.1:5216/show-mode-preview.html';
const canvas = page.locator('.show-canvas');
async function check(label, run) { await run(); checks.push(label); }
async function idle() { await page.evaluate(async () => { await Promise.all(document.getAnimations().map(animation => animation.finished)); }); }
try {
  await page.goto(url, { waitUntil: 'networkidle' });
  await check('six rows, confirmed movement and Czech half point', async () => {
    assert.equal(await canvas.locator('.show-ranking-row').count(), 6);
    assert.equal(await canvas.locator('.show-row-points').first().textContent(), '48,5');
    assert.equal(await canvas.locator('.show-move.up').count(), 3);
  });
  await check('second page and exact question return', async () => {
    await page.getByRole('button', { name: 'Další strana →' }).click();
    assert.match(await canvas.textContent(), /Mimo záběr/);
    await page.getByRole('button', { name: 'Zpět na stejný slide' }).click();
    assert.equal(await canvas.locator('.show-interim-panel').count(), 0);
    assert.match(await canvas.textContent(), /Filmové dvojice/);
    assert.match(await canvas.textContent(), /OTÁZKA 8/);
    await page.getByRole('button', { name: 'Znovu otevřít výsledky' }).click();
    assert.match(await canvas.textContent(), /Mimo záběr/);
  });
  await check('unrevealed leaders absent from finale DOM; older page available', async () => {
    await page.getByRole('button', { name: '2. Finále', exact: true }).click();
    assert.doesNotMatch(await canvas.textContent(), /Až naprší|Páni kluci|Ztraceni v překladu/);
    await page.getByRole('button', { name: /Další odhalené týmy/ }).click();
    assert.match(await canvas.textContent(), /Mimo záběr/);
  });
  await check('one manual step reveals whole shared second place', async () => {
    await page.getByRole('button', { name: 'Odhalit další místo', exact: true }).click();
    assert.equal(await canvas.locator('.show-feature-teams h1').count(), 2);
    assert.match(await canvas.textContent(), /SDÍLENÉ MÍSTO/);
    assert.doesNotMatch(await canvas.textContent(), /Až naprší/);
  });
  await check('winner requires next action, co-winners share score', async () => {
    await page.getByRole('button', { name: 'Odhalit vítěze', exact: true }).click();
    assert.equal(await canvas.locator('.show-winner-names h1').count(), 1);
    await page.getByLabel('Společní vítězové').check();
    assert.equal(await canvas.locator('.show-winner-names h1').count(), 3);
    assert.match(await canvas.locator('.show-winner-score').textContent(), /48,5/);
    await idle();
    await canvas.screenshot({ path: path.join(out, 'shared-winners.png') });
    await page.getByLabel('Společní vítězové').uncheck();
  });
  await check('last-to-first complete group sequence', async () => {
    await page.getByRole('button', { name: 'Zahájit od posledního' }).click();
    for (let rank = 11; rank >= 2; rank--) {
      assert.equal((await canvas.locator('.show-feature-number').textContent()).trim(), `${rank}.`);
      assert.doesNotMatch(await canvas.textContent(), /Až naprší/);
      await page.getByRole('button', { name: 'Odhalit další místo', exact: true }).click();
    }
    assert.equal(await canvas.locator('.show-winner-names h1').count(), 1);
  });
  await check('skip and static mode remove all running animations', async () => {
    await page.getByRole('button', { name: '1. Průběžné', exact: true }).click();
    await page.getByRole('button', { name: 'Přeskočit animaci' }).click();
    assert.equal(await page.evaluate(() => document.getAnimations().filter(animation => animation.playState === 'running').length), 0);
    await page.getByLabel('Statický režim bez animací').check();
    await page.getByRole('button', { name: '3. Vítězové', exact: true }).click();
    assert.equal(await page.evaluate(() => document.getAnimations().length), 0);
  });
  await check('OS reduced motion and no mounted audio/video player', async () => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`${url}?scene=winner&capture=1`, { waitUntil: 'networkidle' });
    assert.equal(await page.evaluate(() => document.getAnimations().length), 0);
    assert.equal(await page.locator('audio,video,iframe').count(), 0);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
  });
  console.log(`Prototype behavioral checks: ${checks.length} PASS`);

  await page.addInitScript(() => {
    window.__showProbe = new Promise(resolve => {
      const observer = new MutationObserver(() => {
        if (!document.querySelector('.show-canvas')) return;
        observer.disconnect();
        const mount = performance.now(), frames = [], longTasks = [];
        let prior;
        const po = new PerformanceObserver(list => { for (const entry of list.getEntries()) if (entry.startTime >= mount) longTasks.push(entry.duration); });
        po.observe({ type: 'longtask', buffered: false });
        function frame(t) {
          if (prior !== undefined) frames.push(t - prior);
          prior = t;
          if (t - mount < 750) requestAnimationFrame(frame);
          else {
            po.disconnect();
            resolve({ domReadyMs: mount, intervals: frames, longTasks, nodes: document.querySelectorAll('.show-canvas *').length });
          }
        }
        requestAnimationFrame(frame);
      });
      observer.observe(document, { childList: true, subtree: true });
    });
  });
  const cdp = await context.newCDPSession(page);
  for (const rate of [1, 4]) {
    await cdp.send('Emulation.setCPUThrottlingRate', { rate });
    for (const scene of ['baseline-results', 'interim']) {
      await page.goto(`${url}?scene=${scene}&capture=1`);
      await page.evaluate(() => window.__showProbe);
    }
    const count = rate === 1 ? 30 : 6;
    for (let i = 0; i < count; i++) {
      const order = i % 2 ? ['interim', 'baseline-results'] : ['baseline-results', 'interim'];
      for (const scene of order) {
        await page.goto(`${url}?scene=${scene}&capture=1`);
        samples.push({ scene, cpuRate: rate, iteration: i, ...await page.evaluate(() => window.__showProbe) });
      }
      if (i % 10 === 9) console.log(`Performance rate ${rate}: ${i + 1}/${count} pairs captured`);
    }
  }
  const quantile = (values, fraction) => [...values].sort((a,b) => a-b)[Math.min(values.length - 1, Math.ceil(values.length * fraction) - 1)];
  const groups = [1,4].flatMap(rate => ['baseline-results','interim'].map(scene => {
    const group = samples.filter(sample => sample.cpuRate === rate && sample.scene === scene);
    const frames = group.flatMap(sample => sample.intervals);
    return { rate, scene, n: group.length, readyMedianMs: quantile(group.map(s => s.domReadyMs), .5), readyP95Ms: quantile(group.map(s => s.domReadyMs), .95), frameMedianMs: quantile(frames,.5), frameP95Ms: quantile(frames,.95), frameMaxMs: Math.max(...frames), intervalsOver25ms: frames.filter(t => t > 25).length, intervalCount: frames.length, longTasks: group.flatMap(s => s.longTasks), nodes: group[0].nodes };
  }));
  const result = { time: new Date().toISOString(), node: process.version, browser: browser.version(), os: `${platform()} ${release()}`, cpu: cpus()[0]?.model, logicalCpus: cpus().length, headless: true, viewport: '1920x1080 DPR1', mode: 'warm Vite development, same synthetic six teams; local rendering only, RAF not GPU presentation', checks, errors, nonlocal, groups, samples };
  await writeFile(path.join(out,'verification.json'), JSON.stringify(result,null,2));
  console.log(JSON.stringify({ checks, errors, nonlocal, groups }));
  assert.equal(errors.length,0); assert.equal(nonlocal.length,0);
} finally { await browser.close(); }
