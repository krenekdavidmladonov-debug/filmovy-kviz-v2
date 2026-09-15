import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { chromium, expect } from '@playwright/test';
import jsQR from 'jsqr';
import { PNG } from 'pngjs';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { getFirestore, getDoc, getDocs, doc, collection } from 'firebase/firestore';
import { assertStagingProject, STAGING_PROJECT, STAGING_URL } from './guard.mjs';
import { stagingWebConfig } from './cloud.mjs';
import { assertIsolatedQaManifest } from './qa-identity-guard.mjs';

assertStagingProject(process.argv[2]);
if (!process.argv[3] || process.argv.length !== 4) throw new Error('Pass the local synthetic staging seed manifest path.');
const seed = JSON.parse(readFileSync(process.argv[3], 'utf8')); assertStagingProject(seed.project);
assertIsolatedQaManifest(seed);
const app = initializeApp(await stagingWebConfig(), 'event-team-tools-qa');
await signInWithEmailAndPassword(getAuth(app), seed.users.admin.email, seed.users.admin.password);
const db = getFirestore(app);
const call = async (name, data) => (await httpsCallable(getFunctions(app, 'europe-west1'), name)(data)).data;
const directory = '.local-data/event-team-tools/online'; mkdirSync(directory, { recursive: true });
const title = `QA Event Team Tools ${Date.now()}`;
let eventId;
let browser;
try {
  const created = await call('createEvent', { expectedRevision: 0, event: { title, startsAt: '2031-01-01T18:00:00Z', timeZone: 'Europe/Prague', venue: { name: 'Synthetic QA venue', publicLocation: 'Synthetic QA only' }, teamCapacity: 5, peopleCapacity: 20, teamSizeMin: 2, teamSizeMax: 6 } });
  eventId = created.eventId;
  writeFileSync(`${directory}/qa.json`, JSON.stringify({ project: STAGING_PROJECT, eventId, title, status: 'created' }, null, 2));
  const state = async () => (await getDoc(doc(db, 'events', eventId))).data();
  const quiz = (await getDoc(doc(db, 'quizzes', seed.quizzes[0]))).data();
  await call('lockEventQuiz', { eventId, expectedRevision: (await state()).revision, quizId: seed.quizzes[0], expectedQuizRevision: quiz.revision ?? 0, acknowledgeWarnings: true });
  const snapshotId = (await state()).quizAssignment.snapshotId;
  // No public window is opened until after the manual add has proved independence.
  browser = await chromium.launch();
  const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname === 'filmovy-kviz.web.app' || url.hostname === 'filmovy-kviz.firebaseapp.com' || /projects\/filmovy-kviz(?:\/|$)/u.test(decodeURIComponent(url.pathname))) return route.abort();
    return route.continue();
  });
  const page = await context.newPage(); page.setDefaultTimeout(60000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${STAGING_URL}/admin/login`);
  await page.getByLabel('E-mail').fill(seed.users.admin.email); await page.getByLabel('Heslo').fill(seed.users.admin.password);
  await page.getByRole('button', { name: 'Přihlásit se' }).click(); await page.waitForURL('**/admin');
  await page.goto(`${STAGING_URL}/admin/events/${eventId}`);
  await page.getByRole('button', { name: '+ Přidat tým', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Název týmu').fill('QA manual team');
  for (const [width, height] of [[1280, 720], [390, 844]]) {
    await page.setViewportSize({ width, height });
    await page.screenshot({ path: `${directory}/manual-${width}.png`, fullPage: true });
  }
  await dialog.getByRole('button', { name: 'Přidat tým', exact: true }).click();
  await expect(dialog).toHaveCount(0, { timeout: 60000 });
  let current = await state(); assert.equal(current.acceptedTeams, 1); assert.equal(current.registrationPublished, false); assert.equal(current.quizAssignment.snapshotId, snapshotId);
  await page.getByRole('link', { name: 'Spravovat týmy a registrace' }).click();
  const row = page.getByRole('row').filter({ hasText: 'QA manual team' });
  await expect(row).toContainText('Neuveden'); await expect(row).toContainText('Přidáno pořadatelem');
  await call('configureEventRegistration', { eventId, expectedRevision: current.revision, published: true, registrationOpensAt: new Date(Date.now() - 60000).toISOString(), registrationClosesAt: new Date(Date.now() + 3600000).toISOString() });
  await page.goto(`${STAGING_URL}/admin/events/${eventId}`);
  const url = `${STAGING_URL}/events/${eventId}`;
  await expect(page.getByLabel('Veřejný odkaz')).toHaveValue(url);
  await page.getByRole('button', { name: 'Kopírovat odkaz' }).click(); await expect(page.getByText('Odkaz zkopírován')).toBeVisible();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), url);
  for (const [width, height] of [[1280, 720], [390, 844]]) {
    await page.setViewportSize({ width, height });
    await page.screenshot({ path: `${directory}/detail-${width}.png`, fullPage: true });
    await page.getByRole('button', { name: 'Zobrazit QR' }).click();
    const source = await dialog.getByRole('img').getAttribute('src');
    const png = PNG.sync.read(Buffer.from(source.split(',')[1], 'base64'));
    assert.equal(jsQR(new Uint8ClampedArray(png.data), png.width, png.height)?.data, url);
    await page.screenshot({ path: `${directory}/qr-${width}.png`, fullPage: true });
    assert.equal(await page.evaluate(() => globalThis.document.documentElement.scrollWidth > globalThis.innerWidth), false);
    await dialog.getByRole('button', { name: 'Zavřít' }).click();
  }
  current = await state(); assert.equal(current.registrationPublished, true); assert.equal(current.acceptedTeams, 1); assert.equal(current.quizAssignment.snapshotId, snapshotId);
  const publicContext = await browser.newContext(); const publicPage = await publicContext.newPage();
  await publicPage.goto(url); await expect(publicPage.getByRole('heading', { name: 'Registrace je otevřená' })).toBeVisible(); await publicContext.close();
  await page.goto(`${STAGING_URL}/admin/events/${eventId}/print`);
  async function pdf(name) {
    await page.getByRole('button', { name: 'Vytvořit náhled' }).click();
    await expect(page.getByTitle('Náhled PDF')).toHaveAttribute('src', /^blob:/u, { timeout: 60000 });
    const download = page.waitForEvent('download'); await page.getByRole('link', { name: 'Stáhnout PDF' }).click();
    const file = `${directory}/${name}.pdf`; await (await download).saveAs(file); assert.equal(readFileSync(file).subarray(0,5).toString(), '%PDF-');
  }
  await page.getByLabel('Jeden tým').check(); await pdf('single');
  await page.getByLabel('Všechny týmy').check(); await pdf('all');
  await page.getByRole('button', { name: /Bodovací tabulka/u }).click(); await pdf('score');
  assert.deepEqual(errors, []);
  console.log('PASS: staging manual team without email while closed, private roster, unchanged snapshot, public link, decoded QR, two viewports, anonymous public page, single/all/score PDF preview-download.');
} finally {
  await browser?.close();
  if (eventId) {
    // Only the event created in this process can be cleaned up; no listing/mutation of other events.
    const ref = doc(db, 'events', eventId);
    let own = (await getDoc(ref)).data();
    assert.equal(own.title, title); assert.equal(own.createdBy, getAuth(app).currentUser.uid);
    const registrations = await getDocs(collection(db, 'events', eventId, 'registrations'));
    for (const registration of registrations.docs) if (registration.data().status === 'accepted') await call('adminCancelEventRegistration', { eventId, registrationId: registration.id });
    own = (await getDoc(ref)).data(); await call('cancelEvent', { eventId, expectedRevision: own.revision });
    own = (await getDoc(ref)).data(); await call('archiveEvent', { eventId, expectedRevision: own.revision });
    writeFileSync(`${directory}/qa.json`, JSON.stringify({ project: STAGING_PROJECT, eventId, title, status: 'archived', acceptedTeams: (await getDoc(ref)).data().acceptedTeams }, null, 2));
    console.log('QA cleanup: own team cancelled and own event archived; historical records/snapshot retained by existing workflow.');
  }
  await deleteApp(app);
}
