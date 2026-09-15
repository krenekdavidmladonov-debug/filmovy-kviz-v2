/* global window, document */
import { test, expect } from '@playwright/test';
import { browserFixture } from '../access/browser-fixture.mjs';
import { writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

async function login(page, person) {
  await page.goto('/admin/login'); await page.getByLabel('E-mail', { exact: true }).fill(person.email); await page.getByLabel('Heslo', { exact: true }).fill(person.password);
  await page.getByRole('button', { name: 'Přihlásit se', exact: true }).click(); await expect(page).toHaveURL(/\/admin$/);
}
test('five isolated identities: UI invitation, verified signup, scoped editor, moderator, scoring, viewer and live revocation', async ({ browser }) => {
  const f = await browserFixture(), contexts = [], failures = [];
  const context = async () => { const c = await browser.newContext({ baseURL: 'http://127.0.0.1:5198', viewport: { width: 1366, height: 900 } }); c.setDefaultTimeout(20000); contexts.push(c); return c; };
  try {
    const owner = await (await context()).newPage(); await login(owner, f.owner); await owner.goto('/admin/users');
    await owner.getByRole('button', { name: 'Pozvat člověka' }).click(); await owner.getByLabel('E-mail', { exact: true }).fill(f.invitedEmail);
    await owner.getByLabel('Role jako výchozí sada').selectOption('creator'); await owner.getByLabel('Rozsah: Kvízy').selectOption('selected');
    await owner.getByLabel('Přidělený kvíz A', { exact: true }).check(); await expect(owner.getByLabel('Mazat obsah kvízu')).not.toBeChecked();
    await owner.getByRole('button', { name: 'Vytvořit odkaz s pozvánkou' }).click(); const link = await owner.getByLabel('Odkaz na pozvánku').inputValue();
    expect(link.includes('#token=')).toBe(true); await owner.reload(); await expect(owner.getByRole('heading', { name: 'Uživatelé a přístupy' })).toBeVisible();
    const creator = await (await context()).newPage(); await creator.goto(link); await creator.getByRole('button', { name: 'Vytvořit osobní účet' }).click();
    await creator.getByLabel('Zobrazované jméno', { exact: true }).fill('Pozvaný tvůrce'); await creator.getByLabel('E-mail', { exact: true }).fill(f.invitedEmail); await creator.getByLabel('Heslo', { exact: true }).fill(f.invitedPassword);
    await creator.getByRole('button', { name: 'Vytvořit účet', exact: true }).click(); await expect(creator.getByText('E-mail čeká na ověření', { exact: false })).toBeVisible();
    await expect(creator.getByRole('button', { name: 'Přijmout pozvánku', exact: true })).toBeDisabled();
    let verifyLink; await expect.poll(async () => { verifyLink = await f.verificationLink(f.invitedEmail); return !!verifyLink; }).toBe(true);
    const verifier = await creator.context().newPage(); await verifier.goto(verifyLink); await verifier.close();
    await creator.getByRole('button', { name: 'Už jsem e-mail ověřil/a' }).click(); await expect(creator.getByRole('button', { name: 'Přijmout pozvánku', exact: true })).toBeEnabled();
    await creator.getByRole('button', { name: 'Přijmout pozvánku', exact: true }).click(); await expect(creator).toHaveURL(/\/account$/);
    await creator.goto('/admin/quizzes'); await expect(creator.getByRole('link', { name: 'Přidělený kvíz A', exact: true })).toBeVisible(); await expect(creator.getByText('Nepřístupný kvíz B', { exact: true })).toHaveCount(0);
    await creator.goto(`/admin/quizzes/${f.quizB}/edit`); await expect(creator.getByText('Obsah nelze zobrazit', { exact: true })).toBeVisible(); await expect(creator.getByLabel('Otázka *', { exact: true })).toHaveCount(0);
    await creator.goto(`/admin/quizzes/${f.quizA}/edit`); await creator.locator('.outline-question').filter({ hasText: 'Otázka pro kolegu' }).click(); await creator.getByLabel('Otázka *', { exact: true }).fill('Upraveno pozvaným tvůrcem');
    await creator.getByRole('button', { name: 'Uložit', exact: true }).click(); await expect(creator.locator('.save-state')).toHaveText('Uloženo'); await expect(creator.getByRole('button', { name: 'Smazat', exact: true })).toHaveCount(0);
    await creator.reload(); await creator.locator('.outline-question').filter({ hasText: 'Upraveno pozvaným tvůrcem' }).click();
    const moderator = await (await context()).newPage(); await login(moderator, f.moderator); await moderator.goto(`/admin/events/${f.eventA.eventId}`);
    await expect(moderator.getByRole('heading', { name: 'Detail akce' })).toBeVisible(); await expect(moderator.getByText('Vybraný kvíz se nepodařilo načíst.')).toHaveCount(0);
    await expect(moderator.getByRole('link', { name: 'Spravovat týmy a registrace' })).toHaveCount(0);
    await moderator.getByRole('button', { name: /Spustit moderování|Otevřít moderování|Zahájit moderování/ }).click(); await expect(moderator).toHaveURL(/\/admin\/live\//);
    const referee = await (await context()).newPage(); await login(referee, f.referee); await referee.goto(`/admin/events/${f.eventA.eventId}/scoring`);
    await expect(referee.getByText('Testovací tým', { exact: true })).toBeVisible(); await expect(referee.locator('input').first()).toBeEnabled();
    await referee.getByLabel('Body — Testovací tým', { exact: true }).fill('3'); await referee.getByRole('button', { name: 'Uložit', exact: true }).click(); await expect(referee.getByText('Uložení potvrzeno serverem.', { exact: true })).toBeVisible();
    await expect.poll(async () => (await f.db.collection(`events/${f.eventA.eventId}/scores`).get()).docs[0]?.get('halfPoints')).toBe(6);
    await moderator.goto(`/admin/events/${f.eventA.eventId}/print`); await expect(moderator.getByRole('heading', { name: 'Náhled dokumentu' })).toBeVisible(); await expect(moderator.getByRole('button', { name: /Klíč odpovědí/ })).toBeDisabled();
    const viewer = await (await context()).newPage(); viewer.on('response', async response => { if (response.url().endsWith('/readAccessData')) { const body = await response.text().catch(() => ''); for (const value of ['ANSWER_PRIVATE_BROWSER', 'NOTE_PRIVATE_BROWSER', 'CONTACT_PRIVATE_BROWSER']) if (body.includes(value)) failures.push(value); } });
    await login(viewer, f.viewer); await viewer.goto(`/admin/quizzes/${f.quizA}/edit`); await viewer.locator('.outline-question').filter({ hasText: 'Upraveno pozvaným tvůrcem' }).click();
    await expect(viewer.getByLabel('Správná odpověď *', { exact: true })).toHaveCount(0); await expect(viewer.getByLabel('Otázka *', { exact: true })).toBeDisabled(); expect(failures).toEqual([]);
    const invited = await f.auth.getUserByEmail(f.invitedEmail); await owner.goto('/admin/users'); const row = owner.getByRole('row').filter({ hasText: f.invitedEmail }); await row.getByRole('button', { name: 'Detail přístupu' }).click();
    await owner.getByLabel('Stav přístupu', { exact: true }).selectOption('suspended'); await owner.getByRole('button', { name: 'Uložit přístup' }).click();
    await expect.poll(async () => (await f.db.doc(`memberships/${invited.uid}`).get()).get('status')).toBe('suspended');
    await expect(creator.getByLabel('Otázka *', { exact: true })).toHaveCount(0); await expect(creator.getByText('Upraveno pozvaným tvůrcem', { exact: true })).toHaveCount(0);
    await owner.evaluate(() => window.scrollTo(0, 0)); await owner.screenshot({ path: '.local-data/users-access/users-desktop.png' });
    await owner.goto('/account'); await owner.getByLabel('Zobrazované jméno', { exact: true }).fill('Osobní QA vlastník'); await owner.getByRole('button', { name: 'Uložit jméno' }).click();
    await expect(owner.getByText('Zobrazované jméno bylo uloženo.', { exact: true })).toBeVisible();
    expect((await f.db.doc(`memberships/${f.owner.uid}`).get()).get('role')).toBe('owner');
    const replacement = randomUUID(); await owner.getByLabel('Aktuální heslo', { exact: true }).fill(f.owner.password); await owner.getByLabel('Nové heslo', { exact: true }).fill(replacement); await owner.getByLabel('Zopakovat nové heslo', { exact: true }).fill(replacement);
    await owner.getByRole('button', { name: 'Změnit heslo', exact: true }).click(); await expect(owner.getByRole('button', { name: 'Vytvořit osobní účet', exact: true })).toBeVisible();
    await login(owner, { ...f.owner, password: replacement }); await owner.reload(); await expect(owner.getByRole('link', { name: 'Uživatelé a přístupy' })).toBeVisible();
    await owner.goto('/account'); const updatedEmail = `changed-${randomUUID()}@example.test`;
    await owner.getByLabel('Aktuální heslo', { exact: true }).fill(replacement); await owner.getByLabel('Nový přihlašovací e-mail', { exact: true }).fill(updatedEmail);
    await owner.getByRole('button', { name: 'Ověřit a změnit e-mail', exact: true }).click(); await expect(owner.getByText('Firebase odeslal ověření na nový e-mail.', { exact: false })).toBeVisible();
    expect((await f.auth.getUser(f.owner.uid)).email).toBe(f.owner.email);
    let changeLink; await expect.poll(async () => { changeLink = await f.verificationLink(updatedEmail, 'VERIFY_AND_CHANGE_EMAIL'); return !!changeLink; }).toBe(true);
    const emailVerifier = await owner.context().newPage(); await emailVerifier.goto(changeLink); await emailVerifier.close();
    await expect.poll(async () => (await f.auth.getUser(f.owner.uid)).email).toBe(updatedEmail);
    await owner.getByRole('button', { name: 'Odhlásit pouze toto zařízení', exact: true }).click(); await expect(owner.getByRole('button', { name: 'Vytvořit osobní účet', exact: true })).toBeVisible(); await login(owner, { email: updatedEmail, password: replacement });
    expect((await f.db.doc(`memberships/${f.owner.uid}`).get()).get('role')).toBe('owner');
    await owner.goto('/account'); await owner.setViewportSize({ width: 390, height: 844 }); await owner.screenshot({ path: '.local-data/users-access/account-mobile.png' });
    expect(await owner.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  } catch (error) {
    // DOM text excludes password/input values and invitation fragments. Only synthetic fixture pages exist here.
    const pages = contexts.flatMap(c => c.pages());
    for (let i = 0; i < pages.length; i++) await writeFile(`.local-data/users-access/browser-page-${i}.txt`, await pages[i].locator('body').innerText().catch(() => 'Page unavailable'));
    throw error;
  } finally { await Promise.allSettled(contexts.map(c => c.close())); await f.dispose(); }
});
