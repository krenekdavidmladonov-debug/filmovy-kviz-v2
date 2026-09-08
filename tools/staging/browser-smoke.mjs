import { readFileSync, mkdirSync } from 'node:fs';
import { chromium, expect as baseExpect } from '@playwright/test';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { assertStagingProject, STAGING_URL } from './guard.mjs';
import { stagingWebConfig } from './cloud.mjs';

assertStagingProject(process.argv[2]);
const expect = baseExpect.configure({ timeout: 30000 });
const seed = JSON.parse(readFileSync('.local-data/staging/seed.json', 'utf8'));
assertStagingProject(seed.project);
mkdirSync('.local-data/staging/pdf', { recursive: true });
const app = initializeApp(await stagingWebConfig(), 'staging-browser-setup');
await signInWithEmailAndPassword(getAuth(app), seed.users.admin.email, seed.users.admin.password);
const invoke = async (name, data) => (await httpsCallable(getFunctions(app, 'europe-west1'), name)(data)).data;
const live = await invoke('createLiveSession', { quizId: seed.quizzes[0] });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 1000 } });
// No V1 request can leave this test, including accidental redirects.
await context.route('**/*', (route) => {
  const url = new URL(route.request().url());
  if (url.hostname === 'filmovy-kviz.web.app' || url.hostname === 'filmovy-kviz.firebaseapp.com' ||
      /projects\/filmovy-kviz(?:\/|$)/u.test(decodeURIComponent(url.pathname))) return route.abort();
  return route.continue();
});
const page = await context.newPage();
page.setDefaultTimeout(60000);
try {
  if (process.argv[3] !== '--finish-pdf-live') {
  await page.goto(`${STAGING_URL}/events`);
  await expect(page.getByRole('heading', { name: 'Testovací filmový kvíz', exact: true })).toBeVisible();
  await page.goto(`${STAGING_URL}/events/${seed.events[0]}`);
  await page.getByLabel('Název týmu').fill(`Browser smoke ${Date.now()}`);
  await page.getByLabel('Počet členů').fill('4');
  await page.getByLabel('E-mail').fill('browser@example.test');
  await page.getByRole('button', { name: 'Přihlásit tým' }).click();
  await expect(page.getByRole('heading', { name: 'Děkujeme, tým byl přihlášen.' })).toBeVisible();
  await page.getByRole('link', { name: 'Spravovat registraci' }).click();
  await page.getByLabel('Počet členů').fill('3');
  await page.getByRole('button', { name: 'Uložit změny' }).click();
  await expect(page.getByText('Registrace byla upravena.')).toBeVisible();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Zrušit registraci' }).click();
  await expect(page.getByRole('heading', { name: 'Registrace je zrušená' })).toBeVisible();
  }
  await page.goto(`${STAGING_URL}/admin/login`);
  await page.getByLabel('E-mail').fill(seed.users.admin.email);
  await page.getByLabel('Heslo').fill(seed.users.admin.password);
  await page.getByRole('button', { name: 'Přihlásit se' }).click();
  await expect(page.getByText('STAGING — pouze syntetická testovací data')).toBeVisible();
  await page.goto(`${STAGING_URL}/admin/events/${seed.events[0]}`);
  await page.getByRole('link', { name: 'Otevřít registrace' }).click();
  await expect(page.getByText('Testovací klapky', { exact: true })).toBeVisible();
  await page.goto(`${STAGING_URL}/admin/events/${seed.events[0]}/print`);
  async function preview(name) {
    await page.getByRole('button', { name: 'Vytvořit náhled' }).click();
    const frame = page.getByTitle('Náhled PDF');
    await expect(frame).toBeVisible();
    await expect(frame).toHaveAttribute('src', /^blob:/u);
    const source = await frame.getAttribute('src');
    const link = page.getByRole('link', { name: 'Stáhnout PDF' });
    await expect(link).toHaveAttribute('href', source);
    const download = page.waitForEvent('download');
    await link.click();
    await (await download).saveAs(`.local-data/staging/pdf/${name}.pdf`);
  }
  if (process.argv[3] !== '--finish-pdf-live') {
  await preview('generic');
  await page.getByLabel('Jeden tým').check();
  await preview('single');
  await page.getByLabel('Všechny týmy').check();
  await preview('all');
  await page.getByRole('button', { name: /Bodovací tabulka/u }).click();
  await preview('score');
  }
  await page.getByRole('button', { name: /Klíč odpovědí/u }).click();
  await preview('answers');
  await page.goto(`${STAGING_URL}/admin/live/${live.sessionId}`);
  const popup = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Otevřít projektor' }).click();
  const projector = await popup;
  await expect(projector).toHaveURL(`${STAGING_URL}/projector/${live.sessionId}`);
  const next = page.getByRole('button', { name: 'Další →', exact: true });
  await next.click();
  await expect(next).toBeEnabled();
  await next.click();
  await expect(projector.getByText(/Ve fiktivním filmu Klapka 1-1/u)).toBeVisible();
  await expect(projector.getByText('Studio 101', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '← Předchozí', exact: true }).click();
  await expect(next).toBeEnabled();
  for (let i = 0; i < 11; i++) { await next.click(); await expect(next).toBeEnabled(); }
  await page.getByRole('button', { name: 'Zobrazit odpověď na otázku 1', exact: true }).click();
  await expect(projector.getByText('Studio 101', { exact: true })).toBeVisible();
  await next.click();
  await expect(projector.getByText('Studio 101', { exact: true })).toHaveCount(0);
  console.log('PASS: staging HTTPS public/manage/admin, all PDF previews/downloads, projector popup NEXT/PREVIOUS/recap.');
} finally {
  await browser.close();
  await deleteApp(app);
}
