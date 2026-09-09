/* global window, document, innerWidth */
import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { finalFixture } from '../e2e/final-reveal-fixture.mjs';
import { assertFinalPayload } from '../e2e/final-payload.mjs';

async function guard(context) {
  await context.route('**/*', r => ['127.0.0.1', 'localhost'].includes(new URL(r.request().url()).hostname) ? r.continue() : r.abort());
  await context.addInitScript(() => {
    window.__audioStarts = 0; window.__audioStops = 0; window.__denyAudio = false;
    const Original = window.AudioContext;
    window.AudioContext = class extends Original {
      resume() { return window.__denyAudio ? Promise.reject(new DOMException('Synthetic policy denial', 'NotAllowedError')) : super.resume(); }
      createOscillator() {
        const node = super.createOscillator(), start = node.start.bind(node), stop = node.stop.bind(node);
        node.start = (...args) => { window.__audioStarts++; start(...args); };
        node.stop = (...args) => { window.__audioStops++; stop(...args); };
        return node;
      }
    };
  });
}
async function login(page, fixture) {
  await page.goto('/admin/login'); await page.getByLabel('E-mail').fill(fixture.login.email); await page.getByLabel('Heslo').fill(fixture.login.password);
  await page.getByRole('button', { name: 'Přihlásit se' }).click(); await expect(page).toHaveURL(/\/admin$/);
  await page.goto('/admin/live/' + fixture.sessionId);
}
const panel = page => page.getByRole('region', { name: 'Ovládání finálního vyhlášení' });
const reveal = page => panel(page).getByRole('button', { name: 'Odhalit další umístění' });
async function prepare(page) { await panel(page).getByRole('button', { name: 'Načíst konečný náhled' }).click(); await expect(panel(page).getByRole('heading', { name: 'Konečný náhled — zatím nepotvrzeno' })).toBeVisible(); }
async function start(page) { await prepare(page); await panel(page).getByRole('button', { name: 'Zahájit vyhlášení' }).click(); }
async function display(browser, fixture) {
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:5195', viewport: { width: 1920, height: 1080 } });
  await guard(context); const page = await context.newPage(); await page.goto('/projector/' + fixture.sessionId);
  return { context, page };
}
async function end(page, projector) {
  await page.getByRole('button', { name: 'Ukončit kvíz', exact: true }).click();
  await expect(projector.getByRole('heading', { name: 'Kvíz skončil' })).toBeVisible();
}
test('three-round finale: two panels, referee, private preview, each raw public group, initiating sound and manual END', async ({ page, context, browser }) => {
  const f = await finalFixture(); let projection, refContext;
  try {
    await guard(context); await login(page, f);
    const other = await context.newPage(); await other.goto('/admin/live/' + f.sessionId);
    projection = await display(browser, f); const projector = projection.page;
    // Last recap remains operable before irreversible END.
    await f.call('goToSlide', { sessionId: f.sessionId, expectedRevision: (await f.session()).revision, position: 5 });
    await expect(page.locator('[data-current-position="5"]')).toBeVisible();
    const preview = await f.previewFinal();
    await prepare(page); expect((await f.rawPublic()).finalReveal).toBeUndefined();
    await expect(projector.getByRole('article', { name: 'Finální vyhlášení' })).toHaveCount(0);
    await panel(page).getByRole('button', { name: 'Zahájit vyhlášení' }).click();
    await expect(projector.getByRole('heading', { name: 'Děkujeme za hru' })).toBeVisible(); assertFinalPayload(await f.rawPublic(), [], 'intro');
    await expect(panel(page).getByRole('button', { name: 'Zobrazit celé konečné pořadí' })).toBeDisabled();
    await projector.evaluate(sessionId => { const c = new BroadcastChannel('filmovy-kviz-projector-' + sessionId); c.postMessage({ type: 'public-state', state: { sessionId, revision: 99999, finalReveal: { mode: 'table', rows: [{ rank: 1, teamName: 'FORGED WINNER', halfPoints: 999 }] } } }); c.close(); }, f.sessionId);
    await expect(projector.getByText('FORGED WINNER')).toHaveCount(0);
    await reveal(page).click(); await expect(projector.getByRole('heading', { name: '4. místo' })).toBeVisible();
    assertFinalPayload(await f.rawPublic(), preview.rows.filter(r => r.rank === 4).slice(0, 8), 'group');
    await panel(page).getByRole('button', { name: 'Další stránka finále' }).click(); await expect(projector.getByText('Strana 2 z 2 · 4. místo')).toBeVisible();
    assertFinalPayload(await f.rawPublic(), preview.rows.filter(r => r.rank === 4).slice(8), 'group');
    const before = await f.rawPublic(), grant = await f.referee();
    refContext = await browser.newContext({ baseURL: 'http://127.0.0.1:5195' }); await guard(refContext); const referee = await refContext.newPage();
    await referee.goto('/referee/' + grant.eventId + '#access=' + grant.accessId + '&key=' + grant.key);
    await referee.getByRole('combobox').selectOption('r3');
    await referee.getByLabel('Body — Alfa', { exact: true }).fill('5,5'); await referee.getByLabel('Důvod opravy — Alfa').fill('Synthetic final correction');
    await referee.getByRole('region', { name: 'Alfa', exact: true }).getByRole('button', { name: 'Uložit', exact: true }).click();
    await expect(referee.getByRole('region', { name: 'Alfa', exact: true })).toContainText('Uložení potvrzeno serverem.');
    expect(await f.rawPublic()).toEqual(before); await expect(panel(page).getByRole('alert')).toContainText('Podklady se změnily');
    for (const rank of [3, 2, 1]) { await reveal(page).click(); await expect.poll(async () => (await f.rawPublic()).finalReveal.rank).toBe(rank); assertFinalPayload(await f.rawPublic(), preview.rows.filter(r => r.rank === rank), 'group'); }
    await expect(projector.getByRole('heading', { name: 'Vítězný tým', exact: true })).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.__audioStarts)).toBe(7);
    expect(await other.evaluate(() => window.__audioStarts)).toBe(0); expect(await projector.evaluate(() => window.__audioStarts)).toBe(0); expect(await referee.evaluate(() => window.__audioStarts)).toBe(0);
    await expect(page.getByRole('button', { name: 'Ukončit kvíz', exact: true })).toBeEnabled();
    await page.reload(); await expect(panel(page).getByText(/Potvrzená verze/)).toBeVisible(); expect(await page.evaluate(() => window.__audioStarts)).toBe(0);
    await panel(page).getByRole('button', { name: 'Zobrazit celé konečné pořadí' }).click(); await expect(projector.getByRole('article', { name: 'Konečné pořadí' })).toBeVisible(); assertFinalPayload(await f.rawPublic(), preview.rows.slice(0, 8), 'table');
    await panel(page).getByRole('button', { name: 'Další stránka finále' }).click(); await expect(projector.getByText(/Strana 2 z 2/)).toBeVisible(); expect(await page.evaluate(() => window.__audioStarts)).toBe(0);
    await end(page, projector); await projector.reload(); await page.reload(); await expect(projector.getByRole('heading', { name: 'Kvíz skončil' })).toBeVisible(); expect((await f.rawPublic()).finalReveal).toBeUndefined();
    expect(await page.evaluate(() => window.__audioStarts)).toBe(0); await expect(panel(page).getByRole('button', { name: 'Přehrát fanfáru ručně' })).toBeDisabled();
  } finally { await refContext?.close(); await projection?.context.close(); await f.close(); }
});

test('lost winner response: explicit retry acknowledges one receipt without another reveal or sound', async ({ page, context, browser }) => {
  const f = await finalFixture(1, true); let projection;
  try {
    await guard(context); await login(page, f); projection = await display(browser, f); await start(page);
    await expect(projection.page.getByRole('heading', { name: 'Děkujeme za hru' })).toBeVisible();
    await page.route('**/controlFinalReveal', async route => {
      if (route.request().postDataJSON()?.data?.action !== 'reveal') return route.continue();
      await route.fetch(); await route.abort('failed');
    });
    await reveal(page).click(); await expect(projection.page.getByRole('heading', { name: 'Vítězný tým', exact: true })).toBeVisible();
    await expect(panel(page).getByRole('button', { name: 'Zopakovat nepotvrzený příkaz' })).toBeVisible();
    const count = (await f.db.collection(`sessions/${f.sessionId}/finalOperations`).get()).size;
    const before = await f.rawPublic(); expect(await page.evaluate(() => window.__audioStarts)).toBe(0);
    await page.unroute('**/controlFinalReveal'); await panel(page).getByRole('button', { name: 'Zopakovat nepotvrzený příkaz' }).click();
    await expect(panel(page).getByRole('button', { name: 'Zopakovat nepotvrzený příkaz' })).toHaveCount(0);
    expect(await f.rawPublic()).toEqual(before); expect((await f.db.collection(`sessions/${f.sessionId}/finalOperations`).get()).size).toBe(count);
    expect(await page.evaluate(() => window.__audioStarts)).toBe(0); await end(page, projection.page);
  } finally { await projection?.context.close(); await f.close(); }
});

for (const superseding of ['END', 'replacement']) test(`late winner response after ${superseding} never plays`, async ({ page, context, browser }) => {
  const f = await finalFixture(1, true); let projection, release;
  try {
    await guard(context); await login(page, f); const other = await context.newPage(); await other.goto('/admin/live/' + f.sessionId);
    projection = await display(browser, f); await start(page); await expect(projection.page.getByRole('heading', { name: 'Děkujeme za hru' })).toBeVisible();
    const held = new Promise(r => { release = r; }); let committed = false;
    await page.route('**/controlFinalReveal', async route => {
      if (route.request().postDataJSON()?.data?.action !== 'reveal') return route.continue();
      const response = await route.fetch(); committed = true; await held; await route.fulfill({ response });
    });
    await reveal(page).click(); await expect.poll(() => committed).toBe(true);
    await expect(projection.page.getByRole('heading', { name: 'Vítězný tým', exact: true })).toBeVisible();
    if (superseding === 'END') await end(other, projection.page);
    else {
      await prepare(other); await panel(other).getByRole('checkbox', { name: /Potvrzuji nahrazení/ }).check();
      await panel(other).getByRole('button', { name: 'Nahradit finále a začít znovu' }).click(); await expect(projection.page.getByRole('heading', { name: 'Děkujeme za hru' })).toBeVisible();
    }
    const delivered = page.waitForResponse(r => r.url().endsWith('/controlFinalReveal') && r.request().postDataJSON()?.data?.action === 'reveal');
    release(); await delivered; await expect(panel(page)).toHaveAttribute('aria-busy', 'false');
    if (superseding === 'END') await expect(panel(page).getByText('Session je ukončená. Finále nelze obnovit.')).toBeVisible();
    else await expect(reveal(page)).toBeEnabled();
    expect(await page.evaluate(() => window.__audioStarts)).toBe(0); expect(await other.evaluate(() => window.__audioStarts)).toBe(0);
    if (superseding !== 'END') await end(other, projection.page);
  } finally { release?.(); await projection?.context.close(); await f.close(); }
});

test('all first on multiple pages: denied audio, manual retry, STOP, hide/reconnect/resume, explicit corrected version and long names', async ({ page, context, browser }) => {
  const f = await finalFixture(10, false, true); let projection;
  try {
    for (let i = 0; i < 10; i++) await f.db.doc(`events/${f.eventId}/registrations/${f.teamIds[i]}`).update({ teamName: `Dlouhý název týmu ${String(i + 1).padStart(2,'0')} — Přátelé filmových příběhů a nečekaných zápletek` });
    await guard(context); await login(page, f); projection = await display(browser, f); const projector = projection.page;
    await start(page); await expect(projector.getByRole('heading', { name: 'Děkujeme za hru' })).toBeVisible();
    await page.evaluate(() => { window.__denyAudio = true; }); await reveal(page).click();
    await expect(projector.getByRole('heading', { name: 'Vítězné týmy' })).toBeVisible();
    await expect(panel(page).getByText('Prohlížeč zvuk nepovolil. Zkuste tlačítko Přehrát fanfáru ručně.')).toBeVisible(); expect(await page.evaluate(() => window.__audioStarts)).toBe(0);
    await page.evaluate(() => { window.__denyAudio = false; }); await panel(page).getByRole('button', { name: 'Přehrát fanfáru ručně' }).click();
    await expect.poll(() => page.evaluate(() => window.__audioStarts)).toBe(7); await panel(page).getByRole('button', { name: 'STOP fanfáry' }).click(); await expect(panel(page).getByText('Fanfára nehraje.', { exact: true })).toBeVisible();
    mkdirSync('.local-data/final-reveal/screenshots', { recursive: true });
    for (const viewport of [{ width:1920,height:1080 }, { width:1280,height:720 }]) {
      await projector.setViewportSize(viewport); const last = await projector.locator('.final-canvas li').last().boundingBox();
      expect(last.y + last.height).toBeLessThanOrEqual(viewport.height); expect(await projector.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await projector.screenshot({ path: `.local-data/final-reveal/screenshots/projector-${viewport.width}.png` });
    }
    await page.setViewportSize({ width:768,height:900 }); await expect(panel(page).getByRole('button', { name: 'Skrýt finále' })).toBeVisible(); expect(await panel(page).evaluate(e => e.getBoundingClientRect().width <= innerWidth)).toBe(true);
    await page.screenshot({ path: '.local-data/final-reveal/screenshots/moderator-768.png' });
    await panel(page).getByRole('button', { name: 'Další stránka finále' }).click(); await expect(projector.getByText('Strana 2 z 2 · 1. místo')).toBeVisible(); expect(await page.evaluate(() => window.__audioStarts)).toBe(7);
    await projection.context.setOffline(true); await expect(projector.getByText('Projektor není připojen', { exact: true })).toBeVisible();
    await panel(page).getByRole('button', { name: 'Skrýt finále' }).click(); await expect.poll(async () => (await f.rawPublic()).finalReveal).toBeUndefined();
    await projection.context.setOffline(false); await expect(projector.getByText('Synthetic prompt', { exact: true })).toBeVisible();
    await panel(page).getByRole('button', { name: 'Pokračovat ve stejné verzi' }).click(); await expect(projector.getByText('Strana 2 z 2 · 1. místo')).toBeVisible(); expect(await page.evaluate(() => window.__audioStarts)).toBe(7);
    await f.score(0, 2, 1); await prepare(page); await panel(page).getByRole('checkbox', { name: /Potvrzuji nahrazení/ }).check();
    await panel(page).getByRole('button', { name: 'Nahradit finále a začít znovu' }).click(); await expect(projector.getByRole('heading', { name: 'Děkujeme za hru' })).toBeVisible(); assertFinalPayload(await f.rawPublic(), [], 'intro');
    expect((await f.session()).finalReveal.revealedCount).toBe(0); expect((await f.db.collection(`sessions/${f.sessionId}/finalVersions`).get()).size).toBe(2);
    await end(page, projector);
  } finally { await projection?.context.close(); await f.close(); }
});

test('late successful winner response after another panel hides it cannot play; rejected command also stays silent', async ({ page, context, browser }) => {
  const f = await finalFixture(1, true); let projection, release;
  try {
    await guard(context); await login(page, f); const other = await context.newPage(); await other.goto('/admin/live/' + f.sessionId);
    projection = await display(browser, f); await start(page); await expect(projection.page.getByRole('heading', { name: 'Děkujeme za hru' })).toBeVisible();
    await page.route('**/controlFinalReveal', route => route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: { status: 'ABORTED', message: 'Synthetic concurrent command' } }) }));
    await reveal(page).click(); await expect(panel(page).getByRole('alert').filter({ hasText: 'Náhled, verze nebo prezentace se změnily' })).toBeVisible(); expect(await page.evaluate(() => window.__audioStarts)).toBe(0);
    await page.unroute('**/controlFinalReveal');
    const held = new Promise(r => { release = r; }); let committed = false;
    await page.route('**/controlFinalReveal', async route => {
      if (route.request().postDataJSON()?.data?.action !== 'reveal') return route.continue();
      const response = await route.fetch(); committed = true; await held; await route.fulfill({ response });
    });
    await reveal(page).click(); await expect.poll(() => committed).toBe(true); await expect(projection.page.getByRole('heading', { name: 'Vítězný tým', exact: true })).toBeVisible();
    await panel(other).getByRole('button', { name: 'Skrýt finále' }).click(); await expect.poll(async () => (await f.rawPublic()).finalReveal).toBeUndefined(); release();
    await expect(panel(page).getByRole('button', { name: 'Pokračovat ve stejné verzi' })).toBeEnabled(); expect(await page.evaluate(() => window.__audioStarts)).toBe(0);
    await page.unroute('**/controlFinalReveal'); await panel(page).getByRole('button', { name: 'Pokračovat ve stejné verzi' }).click(); await expect(projection.page.getByRole('heading', { name: 'Vítězný tým', exact: true })).toBeVisible();
    expect(await page.evaluate(() => window.__audioStarts)).toBe(0); expect(await other.evaluate(() => window.__audioStarts)).toBe(0);
    await prepare(page); await f.score(0, 0, 1); await panel(page).getByRole('checkbox', { name: /Potvrzuji nahrazení/ }).check(); await panel(page).getByRole('button', { name: 'Nahradit finále a začít znovu' }).click();
    await expect(panel(page).getByRole('alert').filter({ hasText: 'Náhled, verze nebo prezentace se změnily' })).toBeVisible(); expect(await page.evaluate(() => window.__audioStarts)).toBe(0);
    await end(other, projection.page);
  } finally { release?.(); await projection?.context.close(); await f.close(); }
});
