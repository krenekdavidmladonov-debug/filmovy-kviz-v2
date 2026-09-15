import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { emailFixture } from '../e2e/registration-email-fixture.mjs';

test('organizer previews, explicitly confirms and follows team message delivery through fake Gmail', async ({ page, context }) => {
  const fixture = await emailFixture({ gmail: true });
  try {
    const { eventId, eventRef, adminCall, capture } = fixture;
    for (const teamName of ['První tým', 'Druhý tým']) await adminCall('adminAddEventTeam', { eventId, requestId: randomUUID(), teamName, memberCount: 2, contactEmail: 'browser@example.test' });
    await adminCall('adminAddEventTeam', { eventId, requestId: randomUUID(), teamName: 'Bez emailu', memberCount: 2 });
    await context.route('**/*', route => ['localhost', '127.0.0.1'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
    await page.goto('/admin/login'); await page.getByLabel('E-mail').fill(fixture.loginEmail); await page.getByLabel('Heslo').fill(fixture.loginPassword); await page.getByRole('button', { name: 'Přihlásit se' }).click();
    await expect(page).not.toHaveURL(/\/admin\/login$/u);
    await page.goto('/admin/events/' + eventId);
    await page.getByRole('button', { name: 'Napsat týmům' }).click();
    const panel = page.getByRole('region', { name: 'Zprávy týmům' });
    await panel.getByLabel('Předmět', { exact: true }).fill('Zítra začínáme v 18:00');
    await panel.getByLabel('Zpráva týmům', { exact: true }).fill('Registrace od 17:30. <b>Čaj & káva</b>');
    await panel.getByRole('button', { name: 'Zobrazit náhled' }).click();
    const preview = panel.getByRole('region', { name: 'Náhled zprávy' });
    await expect(preview).toContainText('Počet příjemců: 2');
    await expect(preview.getByText('Registrace od 17:30. <b>Čaj & káva</b>', { exact: true })).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Odeslat týmům' })).toBeDisabled();
    expect((await eventRef.collection('emailCampaigns').get()).size).toBe(0);
    await panel.getByRole('checkbox').check();
    // Drop only the first response after the server committed: the retry must recover its receipt.
    let lost = false, messageRequest;
    await page.route('**/createEventTeamMessage', async route => {
      if (!lost) { lost = true; messageRequest = route.request().postDataJSON().data; await route.fetch(); await route.abort(); } else await route.continue();
    });
    await panel.getByRole('button', { name: 'Odeslat týmům' }).click();
    await expect(panel.getByRole('button', { name: 'Ověřit stejný požadavek' })).toBeEnabled();
    await fixture.setAdminRole('moderator');
    // Current membership removes private UI and rejects even a committed receipt retry with the old token.
    await expect(panel).toBeHidden();
    expect(messageRequest?.eventId).toBe(eventId);
    await expect(adminCall('createEventTeamMessage', messageRequest)).rejects.toMatchObject({ code: 'functions/permission-denied' });
    expect((await eventRef.collection('emailCampaigns').get()).size).toBe(1);
    await fixture.setAdminRole('admin');
    await page.reload();
    await panel.getByRole('button', { name: 'Ověřit stejný požadavek' }).click();
    const status = panel.getByRole('region', { name: 'Stav zprávy' });
    await expect(status).toContainText('Celkem: 2 · Čeká: 2 · Odesláno: 0 · Selhalo: 0');
    const campaigns = await eventRef.collection('emailCampaigns').get(); expect(campaigns.size).toBe(1);
    const intents = await eventRef.collection('emailIntents').where('campaignId', '==', campaigns.docs[0].id).get(); expect(intents.size).toBe(2);
    for (const doc of intents.docs) await fixture.deliverTask(doc.ref);
    expect(capture.submissions.length).toBe(2); for (const message of capture.messages.values()) { expect(message.to).toBe('browser@example.test'); expect(message.text).not.toContain('registration/manage'); }
    await status.getByRole('button', { name: 'Obnovit stav' }).click();
    await expect(status).toContainText('Celkem: 2 · Čeká: 0 · Odesláno: 2 · Selhalo: 0');
    await page.reload(); await page.getByRole('button', { name: 'Napsat týmům' }).click();
    await panel.getByRole('button', { name: /Zítra začínáme v 18:00/ }).click();
    await expect(status).toContainText('Odesláno: 2');
  } finally { await context.close(); await fixture.dispose(); }
});
