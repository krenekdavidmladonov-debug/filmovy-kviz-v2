import { describe, expect, it } from 'vitest';
import { parsePoints, pointsText, scoreLabel } from '../apps/web/src/features/scoring/model';
import { parseScoreRequest } from '../functions/src/scoring/validation';

describe('event scoring values', () => {
  it('parses exact half-points with either decimal separator, without rounding', () => {
    for (const [text, units] of [['0', 0], ['0,5', 1], ['2.5', 5], ['2,50', 5], [' 12 ', 24], ['4503599627370495.5', Number.MAX_SAFE_INTEGER]] as const) {
      expect(parsePoints(text)).toBe(units);
      expect(parsePoints(pointsText(units))).toBe(units);
    }
    expect(scoreLabel(null)).toBe('Nezadáno');
    expect(scoreLabel(0)).toBe('0 bodů');
    for (const value of ['', ' ', '-1', '-0', '0.25', '1,75', 'NaN', 'Infinity', '1e2', '1.50000000000000001', '4503599627370496', '4503599627370495.75', '1 000']) {
      expect(() => parsePoints(value)).toThrow();
    }
  });
  it('validates the strict server contract and safe numeric ranges', () => {
    const input = { eventId: 'e', snapshotId: 's', teamId: 't', roundId: 'r', requestId: 'id', expectedRevision: 0, halfPoints: 0, reason: '' };
    expect(parseScoreRequest(input).halfPoints).toBe(0);
    expect(parseScoreRequest({ ...input, halfPoints: null, reason: ' Oprava ' }).reason).toBe('Oprava');
    for (const halfPoints of [-1, .5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '2', undefined]) expect(() => parseScoreRequest({ ...input, halfPoints })).toThrow();
    for (const expectedRevision of [-1, .5, Number.MAX_SAFE_INTEGER, Infinity]) expect(() => parseScoreRequest({ ...input, expectedRevision })).toThrow();
    for (const patch of [{ actorUid: 'spoof' }, { managementToken: 'token' }, { reason: 'x'.repeat(301) }, { reason: '\n' }, { teamId: '../other' }, { requestId: '..' }]) {
      expect(() => parseScoreRequest({ ...input, ...patch })).toThrow();
    }
  });
});
