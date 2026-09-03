import { describe, expect, test } from 'vitest';

import { PrintCenterError } from '../functions/src/print/errors';
import { authorizePrintArtifact, parsePrintOptions } from '../functions/src/print/validation';

describe('Print Center authorization', () => {
  test.each(['team-sheets', 'answer-key', 'score-table'] as const)('allows admin to generate %s', (artifact) => {
    expect(() => authorizePrintArtifact('admin', artifact)).not.toThrow();
  });

  test('allows moderator only non-answer documents', () => {
    expect(() => authorizePrintArtifact('moderator', 'team-sheets')).not.toThrow();
    expect(() => authorizePrintArtifact('moderator', 'score-table')).not.toThrow();
    expect(() => authorizePrintArtifact('moderator', 'answer-key')).toThrowError(PrintCenterError);
  });

  test.each([undefined, null, 'ordinary', 'projector'])('denies non-staff role %s', (role) => {
    expect(() => authorizePrintArtifact(role, 'team-sheets')).toThrowError(PrintCenterError);
  });
});

describe('Print Center request allowlist', () => {
  test('accepts bounded typed team abstractions', () => {
    expect(parsePrintOptions({ artifactType: 'team-sheets', disposition: 'inline', mode: 'generic', teams: [] })).toEqual({ artifactType: 'team-sheets', disposition: 'inline', mode: 'generic', teams: [] });
    expect(parsePrintOptions({ artifactType: 'score-table', disposition: 'attachment', teams: [{ name: ' Žluťoučký tým ' }] })).toEqual({ artifactType: 'score-table', disposition: 'attachment', teams: [{ name: 'Žluťoučký tým' }] });
  });

  test.each([
    { artifactType: 'answer-key', disposition: 'inline', correctAnswers: ['tajné'] },
    { artifactType: 'answer-key', disposition: 'inline', mediaUrl: 'https://example.test/private' },
    { artifactType: 'team-sheets', disposition: 'inline', mode: 'generic', teams: [], contact: 'private@example.test' },
  ])('rejects browser payload fields outside the allowlist', (payload) => {
    expect(() => parsePrintOptions(payload)).toThrowError(PrintCenterError);
  });

  test('enforces team count, uniqueness, and safe names', () => {
    const teams = Array.from({ length: 31 }, (_, index) => ({ name: `Tým ${index}` }));
    expect(() => parsePrintOptions({ artifactType: 'score-table', disposition: 'inline', teams })).toThrowError(PrintCenterError);
    expect(() => parsePrintOptions({ artifactType: 'score-table', disposition: 'inline', teams: [{ name: 'Tým' }, { name: 'tým' }] })).toThrowError(PrintCenterError);
    expect(() => parsePrintOptions({ artifactType: 'score-table', disposition: 'inline', teams: [{ name: 'Tým\u0000' }] })).toThrowError(PrintCenterError);
  });
});
