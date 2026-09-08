import { describe, expect, test } from 'vitest';
import jsQR from 'jsqr';
import { PNG } from 'pngjs';
import { refereeUrl, refereeQr } from '../apps/web/src/features/referee/sharing';

describe('private referee QR', () => {
  test('decodes exact local target, uses fragment and differs from registration', async () => {
    const key = 'x'.repeat(43); // Non-live fixture; never a minted capability.
    const url = refereeUrl({ eventId: 'synthetic-event', accessId: 'synthetic-access', key }, { projectId: 'demo-filmovy-kviz-v2', useEmulators: true }, 'http://127.0.0.1:5193');
    const png = PNG.sync.read(Buffer.from((await refereeQr(url)).split(',')[1]!, 'base64'));
    expect(jsQR(new Uint8ClampedArray(png.data), png.width, png.height)?.data === url).toBe(true);
    expect(new URL(url).pathname).toBe('/referee/synthetic-event'); expect(new URL(url).search).toBe('');
    expect(() => refereeUrl({ eventId: 'a', accessId: 'b', key }, { projectId: 'production', useEmulators: false }, 'https://example.test')).toThrow();
  });
});
