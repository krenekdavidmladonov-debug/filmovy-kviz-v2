import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { Timestamp } from 'firebase/firestore';

import { createTokenVault, emulatorTokenVault } from '../functions/src/email/token-vault';
import { managementUrl, registrationEmail } from '../functions/src/email/templates';
import { CaptureEmailTransport } from '../functions/src/dev/capture-email';
import { mapRegistration } from '../apps/web/src/features/events/eventMappers';

const content = { eventTitle: 'Filmový večer <script>alert(1)</script>', startsAtMillis: Date.parse('2031-11-20T18:00:00Z'), timeZone: 'Europe/Prague', venueName: 'Sál & kino', publicLocation: '', teamName: 'Tým "<img src=x onerror=alert(1)>"', memberCount: 4 };
afterEach(() => vi.unstubAllEnvs());

describe('Czech transactional messages', () => {
  for (const type of ['registration-confirmed', 'registration-updated', 'registration-cancelled'] as const) {
    test(type + ' has text, escaped HTML and event/team details', () => {
      const body = registrationEmail(type, content, 'http://localhost:5000/events/synthetic/registration/manage#synthetic');
      expect(body.subject.length > 10).toBe(true);
      expect(body.text.includes(content.teamName) && body.text.includes('19:00') && body.text.includes('Počet hráčů: 4')).toBe(true);
      expect(body.html.includes('<script>') || body.html.includes('<img')).toBe(false);
      expect(body.html.includes('&lt;script&gt;') && body.html.includes('&amp;')).toBe(true);
      expect(body.html.includes('href=')).toBe(type === 'registration-confirmed');
      expect(body.text.includes('Tým již není aktivně přihlášen')).toBe(type === 'registration-cancelled');
    });
  }
  test('requires a confirmation link and rejects unsafe link protocols', () => {
    expect(() => registrationEmail('registration-confirmed', content)).toThrow();
    expect(() => registrationEmail('registration-confirmed', content, 'javascript:alert(1)')).toThrow();
  });
  test('keeps capabilities in URL fragments on the configured server origin', () => {
    const token = randomBytes(32).toString('base64url');
    const link = new URL(managementUrl('https://mail.example.test', 'event', 'registration', token));
    expect(link.search === '' && !link.pathname.includes(token) && link.hash.includes(token)).toBe(true);
    for (const origin of ['http://remote.example.test', 'https://user:password@example.test', 'https://example.test/redirect', 'javascript:alert(1)']) {
      expect(() => managementUrl(origin, 'event', 'registration', token)).toThrow();
    }
  });
  test('prevents subject header injection', () => {
    expect(registrationEmail('registration-updated', { ...content, eventTitle: 'Akce\r\nBcc: forged' }).subject).not.toMatch(/[\r\n]/u);
  });
});

describe('protected management capability', () => {
  test('round-trips without plaintext persistence and uses fresh nonces', () => {
    const vault = createTokenVault('unit-key', randomBytes(32));
    const token = randomBytes(32).toString('base64url');
    const first = vault.seal(token, 'event/registration/intent');
    const second = vault.seal(token, 'event/registration/intent');
    expect(vault.open(first, 'event/registration/intent') === token).toBe(true);
    expect(JSON.stringify(first).includes(token)).toBe(false);
    expect(first.ciphertext !== second.ciphertext && first.nonce !== second.nonce).toBe(true);
  });
  test('rejects cross-intent replay, tampering, unknown key version and wrong key safely', () => {
    const vault = createTokenVault('unit-key', randomBytes(32));
    const token = randomBytes(32).toString('base64url');
    const envelope = vault.seal(token, 'event/registration/intent');
    for (const operation of [
      () => vault.open(envelope, 'another/registration/intent'),
      () => vault.open({ ...envelope, ciphertext: randomBytes(43).toString('base64') }, 'event/registration/intent'),
      () => vault.open({ ...envelope, keyId: 'unknown' }, 'event/registration/intent'),
      () => createTokenVault('unit-key', randomBytes(32)).open(envelope, 'event/registration/intent'),
    ]) expect(operation).toThrow('Management link protection is unavailable.');
  });
  for (const [project, host] of [['filmovy-kviz-v2-staging', '127.0.0.1:8080'], ['demo-filmovy-kviz-v2', 'remote.test:8080'], ['demo-filmovy-kviz-v2', 'localhost:99999'], ['demo-filmovy-kviz-v2', '']]) {
    test(`refuses emulator fixture outside demo/local guard (${project}, ${host || 'missing'})`, () => {
      expect(() => emulatorTokenVault({ GCLOUD_PROJECT: project, FIRESTORE_EMULATOR_HOST: host })).toThrow('not configured');
    });
  }
  test('does not log tokens, provider exceptions or message bodies', () => {
    for (const path of ['functions/src/email/delivery.ts', 'functions/src/email/token-vault.ts', 'functions/src/email/intent.ts', 'functions/src/dev/capture-email.ts']) {
      expect(readFileSync(path, 'utf8')).not.toMatch(/(?:console|logger)\./u);
    }
  });
});

test('local capture deduplicates an accepted message after a lost response', async () => {
  vi.stubEnv('GCLOUD_PROJECT', 'demo-filmovy-kviz-v2'); vi.stubEnv('FIRESTORE_EMULATOR_HOST', '127.0.0.1:8080');
  const capture = new CaptureEmailTransport();
  const message = { idempotencyKey: 'logical-message', to: 'synthetic@example.test', ...registrationEmail('registration-updated', content) };
  capture.nextFailure = 'before-accept';
  await expect(capture.send(message)).rejects.toThrow('Synthetic delivery failure.');
  expect(capture.messages.size).toBe(0);
  capture.nextFailure = 'after-accept';
  await expect(capture.send(message)).rejects.toThrow('Synthetic lost response.');
  await capture.send(message);
  expect(capture.messages.size).toBe(1);
  await expect(capture.send({ ...message, subject: 'Different retry payload' })).rejects.toThrow('Synthetic idempotency payload mismatch.');
});

test('organizer mapper includes only safe delivery status and timestamp', () => {
  const stamp = Timestamp.fromDate(new Date('2030-01-01T00:00:00Z'));
  const row = mapRegistration('synthetic', { eventId: 'event', teamName: 'Synthetic', memberCount: 4, contactEmail: 'team@example.test', status: 'accepted', createdAt: stamp, updatedAt: stamp,
    emailDelivery: { status: 'failed', updatedAt: stamp, providerPayload: 'DO NOT EXPOSE', rawToken: 'DO NOT EXPOSE' } });
  expect(row.emailDelivery?.status).toBe('failed');
  expect(JSON.stringify(row).includes('DO NOT EXPOSE')).toBe(false);
});
