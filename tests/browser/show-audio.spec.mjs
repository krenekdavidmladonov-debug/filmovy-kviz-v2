/* global window */
import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { createShowAudioFixture, showAudioCueNames, showDefaults } from '../e2e/show-audio-emulator.mjs';
import { syntheticAudio } from '../e2e/media-fixture.mjs';

const labels = ['Úvod', 'Průběžné výsledky', 'Napětí', 'Odhalení', 'Vítězové'];
async function localNativeAudio(context) {
  await context.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  await context.addInitScript(() => {
    window.__showAudio = { starts: 0, stops: 0, decoded: 0, gains: [], deny: false };
    const NativeAudioContext = window.AudioContext;
    window.AudioContext = class extends NativeAudioContext {
      resume() { return window.__showAudio.deny ? Promise.reject(new DOMException('Test browser policy denial', 'NotAllowedError')) : super.resume(); }
      async decodeAudioData(...args) { const result = await super.decodeAudioData(...args); window.__showAudio.decoded++; return result; }
      createBufferSource() {
        const node = super.createBufferSource(), start = node.start.bind(node), stop = node.stop.bind(node);
        node.start = (...args) => { start(...args); window.__showAudio.starts++; };
        node.stop = (...args) => { stop(...args); window.__showAudio.stops++; };
        return node;
      }
      createGain() {
        const node = super.createGain(), connect = node.connect.bind(node), disconnect = node.disconnect.bind(node);
        const record = { node, connected: false }; window.__showAudio.gains.push(record);
        node.connect = (...args) => { const result = connect(...args); if (args[0] === this.destination) record.connected = true; return result; };
        node.disconnect = (...args) => { const result = disconnect(...args); record.connected = false; return result; };
        return node;
      }
    };
  });
}
const graph = page => page.evaluate(() => ({ starts: window.__showAudio.starts, stops: window.__showAudio.stops,
  decoded: window.__showAudio.decoded, outputs: window.__showAudio.gains.filter(g => g.connected).length,
  gain: window.__showAudio.gains.findLast(g => g.connected)?.node.gain.value }));
const panel = page => page.getByRole('region', { name: 'Zvuk show mode' });
async function login(page, f) {
  await page.goto('/admin/login'); await page.getByLabel('E-mail').fill(f.admin.login.email); await page.getByLabel('Heslo').fill(f.admin.login.password);
  await page.getByRole('button', { name: 'Přihlásit se', exact: true }).click(); await expect(page).toHaveURL(/\/admin$/);
  await page.goto('/admin/live/' + f.sessionId); await page.getByRole('checkbox', { name: 'SHOW MODE', exact: true }).check();
  await expect(panel(page)).toHaveAttribute('data-save-state', 'ready');
}
async function manual(page, label = 'Úvod') {
  await panel(page).getByRole('button', { name: 'Přehrát: ' + label, exact: true }).click();
  await expect(panel(page).getByRole('status')).toContainText('Přehrává se:');
  await expect.poll(async () => (await graph(page)).outputs).toBe(1);
}

test('five real WAV uploads persist; native decode/play/volume/STOP and offline/unmount/revocation cleanup', async ({ page, context }) => {
  const f = await createShowAudioFixture();
  try {
    await localNativeAudio(context); await login(page, f);
    expect((await graph(page)).starts).toBe(0);
    await panel(page).getByText('Nastavení SHOW MODE a vlastní MP3/WAV', { exact: true }).click();
    for (const label of labels) {
      const picker = panel(page).locator('.show-audio-picker').filter({ has: page.locator('legend').filter({ hasText: new RegExp('^' + label + '$') }) });
      await picker.getByLabel(label + ' — soubor', { exact: true }).setInputFiles({ name: 'synthetic-' + labels.indexOf(label) + '.wav', mimeType: 'audio/wav', buffer: syntheticAudio(12) });
      await expect(picker.getByText('Přiřazený ověřený soubor', { exact: true })).toBeVisible();
    }
    await panel(page).getByLabel('Povolit zvuk', { exact: true }).check();
    await panel(page).getByRole('button', { name: 'Uložit nastavení show', exact: true }).click();
    await expect(panel(page)).toHaveAttribute('data-save-state', 'saved');
    const saved = await f.admin.call('readEventShowPreferences', { eventId: f.eventId });
    expect(Object.keys(saved.preferences.cues).sort()).toEqual([...showAudioCueNames].sort());
    for (const reference of Object.values(saved.preferences.cues)) expect(reference).toMatch(/^quiz-asset:/);
    expect((await graph(page)).starts).toBe(0);
    await page.reload(); await page.getByRole('checkbox', { name: 'SHOW MODE', exact: true }).check();
    await expect(panel(page)).toHaveAttribute('data-save-state', 'ready'); expect((await graph(page)).starts).toBe(0);
    await manual(page); expect((await graph(page)).decoded).toBe(1);
    await panel(page).getByText('Nastavení SHOW MODE a vlastní MP3/WAV', { exact: true }).click();
    await panel(page).getByRole('slider').press('Home');
    for (let i = 0; i < 13; i++) await panel(page).getByRole('slider').press('ArrowRight');
    await expect.poll(async () => (await graph(page)).gain).toBeCloseTo(.13, 3);
    // A real config poll must preserve an unsaved local gain adjustment.
    await expect.poll(async () => (await f.admin.call('readEventShowPreferences', { eventId: f.eventId })).preferences.volume).toBe(.25);
    await page.waitForTimeout(2300); expect((await graph(page)).gain).toBeCloseTo(.13, 3);
    await panel(page).getByRole('button', { name: 'STOP zvuku', exact: true }).click(); expect((await graph(page)).outputs).toBe(0);
    await manual(page); await context.setOffline(true); await expect.poll(async () => (await graph(page)).outputs).toBe(0);
    await context.setOffline(false); await expect(panel(page).getByRole('button', { name: 'Přehrát: Úvod', exact: true })).toBeEnabled();
    const before = (await graph(page)).starts; await page.waitForTimeout(250); expect((await graph(page)).starts).toBe(before);
    await manual(page); await page.getByRole('checkbox', { name: 'SHOW MODE', exact: true }).uncheck();
    expect((await graph(page)).outputs).toBe(0);
    await page.getByRole('checkbox', { name: 'SHOW MODE', exact: true }).check();
    await expect(panel(page)).toHaveAttribute('data-save-state', 'ready'); await manual(page);
    const memberRef = f.db.doc('memberships/' + f.admin.uid), member = (await memberRef.get()).data();
    await memberRef.update({ permissions: member.permissions.filter(permission => permission !== 'event.live'), version: member.version + 1 });
    await expect.poll(async () => (await graph(page)).outputs).toBe(0);
    await memberRef.set(member);
  } finally { await f.dispose(); }
});

test('fresh confirmed publication only; retry/reload/other panel stay silent; question media interlock and autoplay fallback', async ({ page, context }) => {
  const f = await createShowAudioFixture(); let other;
  try {
    await f.configure({ ...showDefaults, audioEnabled: true, cues: Object.fromEntries(showAudioCueNames.map(cue => [cue, f.audio.reference])) });
    await localNativeAudio(context); await login(page, f);
    other = await context.newPage(); await other.goto('/admin/live/' + f.sessionId);
    await other.getByRole('checkbox', { name: 'SHOW MODE', exact: true }).check(); await expect(panel(other)).toHaveAttribute('data-save-state', 'ready');
    const interim = page.getByRole('region', { name: 'Ovládání průběžných výsledků' });
    await interim.getByRole('button', { name: 'Načíst náhled výsledků', exact: true }).click();
    const request = page.waitForRequest(r => r.method() === 'POST' && r.url().endsWith('/controlInterimResults'));
    await interim.getByRole('button', { name: 'Zobrazit výsledky', exact: true }).click();
    const command = (await request).postDataJSON().data;
    await expect.poll(async () => (await graph(page)).starts).toBe(1); expect((await graph(other)).starts).toBe(0);
    await panel(page).getByRole('button', { name: 'STOP zvuku', exact: true }).click();
    const retry = await f.admin.call('controlInterimResults', command); expect(retry.replayed).toBe(true);
    expect((await graph(page)).starts).toBe(1); expect((await graph(other)).starts).toBe(0);
    // The second panel's silence is proven. Close its question player before testing
    // this panel's actual native question lifecycle (remote commands below use a separate SDK).
    await other.close(); other = undefined;
    await page.reload(); await expect(panel(page)).toHaveAttribute('data-save-state', 'ready'); expect((await graph(page)).starts).toBe(0);
    await page.getByRole('region', { name: 'Ovládání průběžných výsledků' }).getByRole('button', { name: 'Skrýt výsledky a vrátit prezentaci', exact: true }).click();
    // A click dispatches a callable; wait for the committed hide before another server mutation.
    await expect.poll(async () => (await f.session()).interimResults).toBeUndefined();
    let state = await f.session(); await f.admin.call('goToSlide', { sessionId: f.sessionId, expectedRevision: state.revision, position: 2 });
    await expect(page.locator('[data-current-position="2"]')).toBeVisible();
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await expect.poll(async () => (await f.session()).mediaPlaybackState).toBe('playing');
    await expect(page.locator('.media-controls').getByRole('status')).toHaveText('Přehrává se');
    await expect(panel(page).getByRole('button', { name: 'Přehrát: Úvod', exact: true })).toBeDisabled(); expect((await graph(page)).outputs).toBe(0);
    const stopped = page.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith('/stopMedia'));
    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    expect((await stopped).ok()).toBe(true);
    await expect.poll(async () => (await f.session()).mediaPlaybackState).toBe('idle');
    await expect(panel(page).getByRole('button', { name: 'Přehrát: Úvod', exact: true })).toBeEnabled();
    await page.evaluate(() => { window.__showAudio.deny = true; });
    await panel(page).getByRole('button', { name: 'Přehrát: Úvod', exact: true }).click();
    await expect(panel(page).getByRole('status')).toContainText('Prohlížeč zvuk nepovolil'); expect((await graph(page)).outputs).toBe(0);
    await page.evaluate(() => { window.__showAudio.deny = false; }); await manual(page);
    // Another panel starting a question must invalidate prior local suppression and stop show output.
    state = await f.session(); await f.admin.call('playMedia', { sessionId: f.sessionId, expectedRevision: state.revision });
    await expect.poll(async () => (await graph(page)).outputs).toBe(0);
    expect((await f.rawPublic()).mediaSource).toBeUndefined();
    await f.admin.call('stopMedia', { sessionId: f.sessionId, expectedRevision: (await f.session()).revision });
    await f.admin.call('controlFinalReveal', { eventId: f.eventId, sessionId: f.sessionId, action: 'start', requestId: randomUUID(), expectedRevision: (await f.session()).revision, versionId: null, sourceFingerprint: (await f.previewFinal()).sourceFingerprint });
    expect((await graph(page)).outputs).toBe(0);
  } finally { await other?.close(); await f.dispose(); }
});

test('automatic cue delayed past three seconds stays silent without a revision change; new manual gesture still plays', async ({ page, context }) => {
  const f = await createShowAudioFixture();
  let release, finish, held = false;
  const gate = new Promise(resolve => { release = resolve; }), completed = new Promise(resolve => { finish = resolve; });
  const match = url => url.pathname.endsWith('/readQuizMedia') && url.searchParams.get('eventId') === f.eventId;
  const delay = async route => {
    // Preserve actual protected gateway bytes, MIME and status; delay only their browser delivery.
    const response = await route.fetch(), body = await response.body();
    held = true; await gate;
    try { await route.fulfill({ response, body }); } finally { finish(); }
  };
  try {
    await f.configure({ ...showDefaults, audioEnabled: true, cues: { interim: f.audio.reference } });
    await localNativeAudio(context); await login(page, f);
    await page.route(match, delay);
    const interim = page.getByRole('region', { name: 'Ovládání průběžných výsledků' });
    await interim.getByRole('button', { name: 'Načíst náhled výsledků', exact: true }).click();
    await interim.getByRole('button', { name: 'Zobrazit výsledky', exact: true }).click();
    await expect.poll(() => held).toBe(true);
    const revision = (await f.session()).revision;
    await page.waitForTimeout(3300);
    expect((await f.session()).revision).toBe(revision);
    release(); await completed;
    await expect(panel(page).getByRole('status')).toHaveText('Zvuk nehraje.');
    expect((await graph(page)).starts).toBe(0); expect((await graph(page)).outputs).toBe(0);
    await page.unroute(match, delay);
    await manual(page, 'Průběžné výsledky');
    expect((await graph(page)).starts).toBe(1); expect((await graph(page)).decoded).toBe(1);
    await panel(page).getByRole('button', { name: 'STOP zvuku', exact: true }).click(); expect((await graph(page)).outputs).toBe(0);
  } finally { release?.(); await page.unroute(match, delay); await f.dispose(); }
});
