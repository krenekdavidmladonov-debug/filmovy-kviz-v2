import { expect, test, type Page } from '@playwright/test';

async function login(page: Page, baseURL: string | undefined, email = 'admin@example.test'): Promise<void> {
  await page.goto(`${baseURL}/admin/login`);
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Heslo').fill('LocalQuiz123!');
  await page.getByRole('button', { name: 'Přihlásit se' }).click();
  await expect(page).not.toHaveURL(/\/admin\/login$/u);
  await expect(page).toHaveURL(/\/admin(?:\/|$)/u);
}

async function createEvent(page: Page, baseURL: string | undefined, title: string): Promise<void> {
  await page.goto(`${baseURL}/admin/events/new`);
  await page.getByLabel('Název akce').fill(title);
  await page.getByLabel('Datum a čas').fill('2026-11-20T19:00');
  await page.getByLabel('Místo', { exact: true }).fill('Syntetický sál');
  await page.getByLabel('Veřejné upřesnění místa').fill('Praha');
  await page.getByRole('button', { name: 'Vytvořit akci' }).click();
  await expect(page).not.toHaveURL(/\/admin\/events\/new$/u);
  await expect(page).toHaveURL(/\/admin\/events\/[^/]+$/u);
}

async function expectPreviewAndSharedDownload(page: Page): Promise<void> {
  const frame = page.getByTitle('Náhled PDF');
  await expect(frame).toBeVisible();
  await expect(frame).toHaveAttribute('src', /^blob:/u);
  const source = await frame.getAttribute('src');
  await expect(page.getByRole('link', { name: 'Stáhnout PDF' })).toHaveAttribute('href', source ?? 'missing');
  await expect(page.getByRole('button', { name: 'Vytisknout' })).toBeEnabled();
}

test('Print Center generates all documents from a locked event and reuses preview bytes', async ({ page, baseURL }) => {
  await login(page, baseURL);
  await createEvent(page, baseURL, 'Syntetická PDF browser akce');
  const detailUrl = page.url();
  const eventId = /\/admin\/events\/([^/]+)$/u.exec(detailUrl)?.[1];
  expect(eventId).toBeTruthy();
  await page.getByRole('link', { name: 'Otevřít registrace' }).click();
  await page.getByLabel('Otevření').fill('2020-01-01T00:00');
  await page.getByLabel('Uzavření').fill('2030-01-01T00:00');
  await page.getByLabel('Zveřejnit registraci').check();
  await page.getByRole('button', { name: 'Uložit nastavení' }).click();
  await expect(page.getByText('Nastavení registrací bylo uloženo.')).toBeVisible();
  await page.getByRole('button', { name: 'Odhlásit se' }).click();
  await expect(page).toHaveURL(/\/admin\/login$/u);
  await page.goto(`${baseURL}/events/${eventId}`);
  await page.getByLabel('Název týmu').fill('Syntetický PDF tým');
  await page.getByLabel('Počet členů').fill('4');
  await page.getByLabel('E-mail').fill('pdf-team@example.test');
  await page.getByRole('button', { name: 'Přihlásit tým' }).click();
  await expect(page.getByRole('heading', { name: 'Děkujeme, tým byl přihlášen.' })).toBeVisible();
  await login(page, baseURL);
  await page.goto(detailUrl);
  await page.locator('[data-testid="event-quiz-assignment"] select').selectOption({ value: 'preflight-ready-e2e' }, { force: true });
  await expect(page.locator('[data-preflight-status="READY"]')).toBeVisible();
  await page.getByRole('button', { name: 'Zkontrolovat a připravit' }).click();
  await expect(page.getByRole('heading', { name: 'Kvíz připraven' })).toBeVisible();
  await page.getByRole('link', { name: 'Otevřít tiskové centrum' }).click();
  await expect(page).toHaveURL(/\/admin\/events\/[^/]+\/print$/u);

  await page.getByRole('button', { name: 'Vytvořit náhled' }).click();
  await expectPreviewAndSharedDownload(page);

  await page.getByLabel('Jeden tým').check();
  await expect(page.getByRole('combobox', { name: 'Tým', exact: true })).toHaveValue(/.+/u);
  await page.getByRole('button', { name: 'Vytvořit náhled' }).click();
  await expectPreviewAndSharedDownload(page);

  await page.getByLabel('Všechny týmy').check();
  await page.getByRole('button', { name: 'Vytvořit náhled' }).click();
  await expectPreviewAndSharedDownload(page);

  await page.getByRole('button', { name: /Bodovací tabulka/u }).click();
  await expect(page.getByText('Server použije 1 přijatých týmů.')).toBeVisible();
  await page.getByRole('button', { name: 'Vytvořit náhled' }).click();
  await expectPreviewAndSharedDownload(page);

  await page.getByRole('button', { name: /Klíč odpovědí/u }).click();
  await expect(page.getByText(/browser je nikdy neposílá/iu)).toBeVisible();
  await page.getByRole('button', { name: 'Vytvořit náhled' }).click();
  await expectPreviewAndSharedDownload(page);

  const printUrl = page.url();
  await page.getByRole('button', { name: 'Odhlásit se' }).click();
  await expect(page).toHaveURL(/\/admin\/login$/u);
  await login(page, baseURL, 'moderator@example.test');
  await page.goto(printUrl);
  await expect(page.getByRole('button', { name: /Klíč odpovědí/u })).toBeDisabled();
});

test('unlocked events explain the required lock and moderator cannot select answer key', async ({ page, baseURL }) => {
  await login(page, baseURL);
  await createEvent(page, baseURL, 'Neuzamčená PDF browser akce');
  const unlockedUrl = `${page.url()}/print`;
  await page.goto(unlockedUrl);
  await expect(page.getByRole('heading', { name: 'Nejdříve uzamkněte kvíz pro tuto akci' })).toBeVisible();

  await page.getByRole('button', { name: 'Odhlásit se' }).click();
  await expect(page).toHaveURL(/\/admin\/login$/u);
  await login(page, baseURL, 'moderator@example.test');
  await page.goto(unlockedUrl);
  await expect(page.getByRole('heading', { name: 'Nejdříve uzamkněte kvíz pro tuto akci' })).toBeVisible();
});
