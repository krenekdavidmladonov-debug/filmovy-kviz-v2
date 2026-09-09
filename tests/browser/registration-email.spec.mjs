import { expect, test } from '@playwright/test';
import { emailFixture } from '../e2e/registration-email-fixture.mjs';

test('registration email: public create, captured CTA, self-update, self-cancel and organizer delivery status', async ({ page, context, baseURL }) => {
  let fixture;
  let phase = 'local fixture';
  try {
    fixture = await emailFixture({ gmail: true });
    const { eventId, eventRef, capture } = fixture;
    await context.route('**/*', route => ['localhost', '127.0.0.1'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
    phase = 'public registration';
    await page.goto(`/events/${eventId}`);
    await page.getByLabel('Název týmu').fill('Browser emailový tým');
    await page.getByLabel('Počet členů').fill('4');
    await page.getByLabel('E-mail').fill('browser@example.test');
    await page.getByRole('button', { name: 'Přihlásit tým' }).click();
    await expect(page.getByRole('heading', { name: 'Děkujeme, tým byl přihlášen.' })).toBeVisible();
    const registrations = (await eventRef.collection('registrations').get()).docs;
    expect(registrations.length).toBe(1);
    const registration = registrations[0];
    const confirmed = (await fixture.intents(registration.id))[0];
    expect(confirmed.data().type).toBe('registration-confirmed');

    phase = 'organizer pending and failed delivery status';
    const staffPage = await context.newPage();
    await staffPage.goto('/admin/login');
    await staffPage.getByLabel('E-mail').fill(fixture.loginEmail);
    await staffPage.getByLabel('Heslo').fill(fixture.loginPassword);
    await staffPage.getByRole('button', { name: 'Přihlásit se' }).click();
    await expect(staffPage).not.toHaveURL(/\/admin\/login$/u);
    await staffPage.goto(`/admin/events/${eventId}/registrations`);
    await expect(staffPage.getByRole('columnheader', { name: 'E-mailové potvrzení' })).toBeVisible();
    await expect(staffPage.getByText('Čeká na odeslání', { exact: true })).toBeVisible();
    capture.nextFailure = 'before-accept';
    await expect(fixture.deliverTask(confirmed.ref, baseURL)).rejects.toThrow('provider-unavailable');
    await staffPage.reload();
    await expect(staffPage.getByText('Čeká na odeslání', { exact: true })).toBeVisible();

    phase = 'confirmation capture and management CTA';
    fixture.advance();
    await fixture.deliverTask(confirmed.ref, baseURL);
    const message = capture.messages.get(confirmed.ref.path);
    expect(message.to === 'browser@example.test' && message.subject === 'Potvrzení registrace – Syntetický emailový večer').toBe(true);
    expect(message.text.includes('Browser emailový tým') && message.text.includes('Syntetický sál') && message.text.includes('19:00') && message.text.includes('Počet hráčů: 4')).toBe(true);
    expect(message.html.includes('Spravovat přihlášku') && message.html.includes('Browser emailový tým')).toBe(true);
    await staffPage.reload();
    await expect(staffPage.getByText('Odesláno', { exact: true })).toBeVisible();
    const cta = /Spravovat přihlášku: (\S+)/u.exec(message.text)[1];
    await page.goto(cta);
    await expect(page.getByRole('heading', { name: 'Správa registrace' })).toBeVisible();
    await expect(page.getByLabel('Název týmu')).toHaveValue('Browser emailový tým');

    phase = 'self-update and captured update message';
    await page.getByLabel('Název týmu').fill('Upravený browser tým');
    await page.getByLabel('Počet členů').fill('3');
    await page.getByRole('button', { name: 'Uložit změny' }).click();
    await expect(page.getByText('Registrace byla upravena.', { exact: true })).toBeVisible();
    const updated = (await fixture.intents(registration.id)).find(doc => doc.data().type === 'registration-updated');
    expect(Boolean(updated)).toBe(true);
    await fixture.deliverTask(updated.ref, baseURL);
    const update = capture.messages.get(updated.ref.path);
    expect(update.subject.startsWith('Změna registrace') && update.text.includes('Upravený browser tým') && update.text.includes('Počet hráčů: 3')).toBe(true);

    phase = 'self-cancel and captured cancellation message';
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: 'Zrušit registraci', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Registrace je zrušená' })).toBeVisible();
    const cancelled = (await fixture.intents(registration.id)).find(doc => doc.data().type === 'registration-cancelled');
    await fixture.deliverTask(cancelled.ref, baseURL);
    const cancellation = capture.messages.get(cancelled.ref.path);
    expect(cancellation.subject.startsWith('Zrušení registrace') && cancellation.text.includes('Tým již není aktivně přihlášen')).toBe(true);
    expect((await fixture.intents(registration.id)).length).toBe(3);
    expect(capture.messages.size).toBe(3);
    expect(capture.submissions.length).toBe(3);
    await staffPage.reload();
    await expect(staffPage.getByText('Odesláno', { exact: true })).toBeVisible();
    phase = 'permanent Gmail failure shown to organizer';
    const permanent = await fixture.publicCall('createEventRegistration', { eventId, teamName: 'Neplatné Gmail oprávnění', memberCount: 3, contactEmail: 'permanent@example.test' });
    const permanentIntent = (await fixture.intents(permanent.registrationId))[0];
    capture.nextFailure = 'invalid-grant';
    await fixture.deliverTask(permanentIntent.ref, baseURL);
    await staffPage.reload();
    await expect(staffPage.getByText('Nepodařilo se', { exact: true })).toBeVisible();
    expect(capture.submissions.length).toBe(3);
    await staffPage.close();
  } catch {
    // Replace Playwright/SDK errors that could contain a secret URL or captured body.
    throw new Error(`Registration email browser scenario failed during: ${phase}. Sensitive diagnostics suppressed.`);
  } finally {
    // Remove capability-bearing pages before Playwright could collect failure context.
    await context.close();
    if (fixture) await fixture.dispose();
  }
});
