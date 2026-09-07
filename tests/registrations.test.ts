import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

import { capacityAfter, effectiveRegistrationStatus, hasCapacity, normalizeTeamName } from '../functions/src/registrations/domain';
import { registrationToPrintTeam } from '../functions/src/registrations/print-adapter';
import { registrationInput } from '../functions/src/registrations/validation';

const capacity = { acceptedTeams: 19, acceptedPeople: 98, maximumTeams: 20, maximumPeople: 100 };

describe('registration domain', () => {
  test('normalizes Unicode, case, and whitespace for event-scoped uniqueness', () => {
    expect(normalizeTeamName('  FILMOVÍ   BORCI ')).toBe(normalizeTeamName('Filmoví borci'));
    expect(normalizeTeamName('Cafe\u0301')).toBe(normalizeTeamName('CAFÉ'));
  });

  test('enforces team and people capacities together', () => {
    expect(hasCapacity(capacity, 1, 2)).toBe(true);
    expect(hasCapacity(capacity, 1, 4)).toBe(false);
    expect(hasCapacity({ ...capacity, acceptedTeams: 20, acceptedPeople: 80 }, 1, 2)).toBe(false);
    expect(capacityAfter(capacity, -1, -4)).toMatchObject({ acceptedTeams: 18, acceptedPeople: 94 });
  });

  test('uses the server timestamp and publication flag for availability', () => {
    const base = { published: true, lifecycleStatus: 'scheduled', opensAtMillis: 100, closesAtMillis: 200, capacity };
    expect(effectiveRegistrationStatus({ ...base, nowMillis: 99 })).toBe('scheduled');
    expect(effectiveRegistrationStatus({ ...base, nowMillis: 100 })).toBe('open');
    expect(effectiveRegistrationStatus({ ...base, nowMillis: 200 })).toBe('closed');
    expect(effectiveRegistrationStatus({ ...base, published: false, nowMillis: 150 })).toBe('closed');
  });

  test('validates and canonicalizes public input server-side', () => {
    expect(registrationInput({ teamName: '  Testovací   tým ', memberCount: 4, contactEmail: 'TEAM@EXAMPLE.TEST' })).toEqual({
      teamName: 'Testovací tým', normalizedTeamName: 'testovací tým', memberCount: 4, contactEmail: 'team@example.test',
    });
    expect(() => registrationInput({ teamName: 'Tým\u0000', memberCount: 4, contactEmail: 'team@example.test' })).toThrow();
    expect(() => registrationInput({ teamName: 'Tým', memberCount: 2.5, contactEmail: 'team@example.test' })).toThrow();
    expect(() => registrationInput({ teamName: 'Tým', memberCount: 4, contactEmail: 'invalid' })).toThrow();
  });

  test('does not contain a token or contact logging path', () => {
    const source = readFileSync('functions/src/registrations/callables.ts', 'utf8');
    expect(source).not.toMatch(/logger\.|console\./u);
  });
});

describe('registration PrintTeam adapter', () => {
  test('maps only stable id and display name for accepted registrations', () => {
    const team = registrationToPrintTeam('registration-1', {
      status: 'accepted', teamName: ' Syntetický tým ', contactEmail: 'private@example.test', managementTokenHash: 'secret',
    });
    expect(team).toEqual({ id: 'registration-1', name: 'Syntetický tým' });
    expect(JSON.stringify(team)).not.toMatch(/email|private|token|hash/iu);
  });

  test('excludes cancelled registrations', () => {
    expect(registrationToPrintTeam('registration-2', { status: 'cancelled', teamName: 'Zrušený tým' })).toBeUndefined();
  });
});
