/* global document */
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../../', import.meta.url));
const out = path.join(root, '.local-data/show-mode-review');
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ executablePath: path.join(root, '.tools/playwright/chromium-1234/chrome-win64/chrome.exe'), headless: true });
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
const errors = [];
const nonlocalRequests = [];
await context.route('**/*', route => {
  const url = new URL(route.request().url());
  if (url.hostname === '127.0.0.1' && url.port === '5216') return route.continue();
  nonlocalRequests.push(url.origin);
  return route.abort();
});
const page = await context.newPage();
page.on('pageerror', error => errors.push(error.message));
const screens = [];
try {
  for (const width of [1920, 1280]) {
    await page.setViewportSize({ width, height: width * 9 / 16 });
    for (const scene of ['interim', 'finale', 'winner']) {
      await page.goto(`http://127.0.0.1:5216/show-mode-preview.html?scene=${scene}&capture=1`, { waitUntil: 'networkidle' });
      await page.locator('.show-canvas').waitFor();
      await page.evaluate(async () => { await document.fonts.ready; await Promise.all(document.getAnimations().map(animation => animation.finished)); });
      const geometry = await page.locator('.show-canvas').evaluate(element => {
        const bounds = element.getBoundingClientRect();
        const overflows = [...element.querySelectorAll('h1,.show-row-name,.show-row-points,.show-interim-footer')].filter(child => {
          const rect = child.getBoundingClientRect();
          return rect.bottom > bounds.bottom + 1 || rect.right > bounds.right + 1 || rect.left < bounds.left - 1 || rect.top < bounds.top - 1;
        }).map(child => child.textContent);
        return { width: bounds.width, height: bounds.height, overflows };
      });
      await page.screenshot({ path: path.join(out, `${scene}-${width}.png`) });
      screens.push({ scene, viewport: width, ...geometry });
    }
  }
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto('http://127.0.0.1:5216/show-mode-preview.html', { waitUntil: 'networkidle' });
  await page.screenshot({ path: path.join(out, 'moderator-prototype.png'), fullPage: true });
  const result = { time: new Date().toISOString(), browser: browser.version(), screens, errors, nonlocalRequests };
  await writeFile(path.join(out, 'capture.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
  if (errors.length || nonlocalRequests.length || screens.some(screen => screen.overflows.length)) process.exitCode = 1;
} finally { await browser.close(); }
