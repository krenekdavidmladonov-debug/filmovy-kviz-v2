import { describe, expect, it } from 'vitest';

import { parseFirebaseEmulatorPort } from '../apps/web/src/services/firebase/emulators';

describe('Firebase emulator endpoint configuration', () => {
  it('keeps established defaults when no isolated audit port is supplied', () => {
    expect(parseFirebaseEmulatorPort(undefined, 'TEST_PORT', 9099)).toBe(9099);
    expect(parseFirebaseEmulatorPort('', 'TEST_PORT', 8080)).toBe(8080);
  });

  it('accepts an explicit bounded localhost port', () => {
    expect(parseFirebaseEmulatorPort('9299', 'TEST_PORT', 9099)).toBe(9299);
  });

  it.each(['remote:9099', '0', '65536', '-1', '9.5'])('fails closed for invalid port %s', (value) => {
    expect(() => parseFirebaseEmulatorPort(value, 'TEST_PORT', 9099)).toThrow(/TEST_PORT/u);
  });
});
