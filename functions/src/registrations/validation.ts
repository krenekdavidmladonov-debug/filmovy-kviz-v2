import { HttpsError } from 'firebase-functions/v2/https';

import { normalizeTeamName } from './domain.js';
import type { RegistrationInput } from './types.js';

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new HttpsError('invalid-argument', 'Request is malformed.');
  }
  return value as Record<string, unknown>;
}
function safeText(value: unknown, field: string, minimum: number, maximum: number): string {
  if (typeof value !== 'string') throw new HttpsError('invalid-argument', `${field} is required.`);
  const result = value.normalize('NFC').trim().replace(/\s+/gu, ' ');
  const unsafe = [...result].some((character) => {
    const point = character.codePointAt(0) ?? 0;
    return point <= 0x1f || (point >= 0x7f && point <= 0x9f)
      || (point >= 0x202a && point <= 0x202e) || (point >= 0x2066 && point <= 0x2069);
  });
  if (result.length < minimum || result.length > maximum || unsafe) {
    throw new HttpsError('invalid-argument', `${field} is invalid.`);
  }
  return result;
}

export function requestId(data: unknown, field: string): string {
  const value = record(data)[field];
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,1500}$/u.test(value)) {
    throw new HttpsError('invalid-argument', `${field} is invalid.`);
  }
  return value;
}

export function requestToken(data: unknown): string {
  const value = record(data).token;
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$/u.test(value)) {
    throw new HttpsError('not-found', 'Registration was not found.');
  }
  return value;
}

export function registrationInput(data: unknown): RegistrationInput {
  const value = record(data);
  const teamName = safeText(value.teamName, 'teamName', 2, 80);
  if (!Number.isInteger(value.memberCount) || (value.memberCount as number) < 1 || (value.memberCount as number) > 1_000) {
    throw new HttpsError('invalid-argument', 'memberCount must be a positive integer.');
  }
  const contactEmail = safeText(value.contactEmail, 'contactEmail', 3, 254).toLocaleLowerCase('en-US');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(contactEmail)) {
    throw new HttpsError('invalid-argument', 'contactEmail is invalid.');
  }
  return {
    teamName,
    normalizedTeamName: normalizeTeamName(teamName),
    memberCount: value.memberCount as number,
    contactEmail,
  };
}

export function registrationWindow(data: unknown): { opensAt: Date; closesAt: Date; published: boolean } {
  const value = record(data);
  if (typeof value.registrationOpensAt !== 'string' || typeof value.registrationClosesAt !== 'string'
    || typeof value.published !== 'boolean') {
    throw new HttpsError('invalid-argument', 'Registration window is required.');
  }
  const opensAt = new Date(value.registrationOpensAt);
  const closesAt = new Date(value.registrationClosesAt);
  if (Number.isNaN(opensAt.getTime()) || Number.isNaN(closesAt.getTime()) || opensAt >= closesAt) {
    throw new HttpsError('invalid-argument', 'Registration window is invalid.');
  }
  return { opensAt, closesAt, published: value.published };
}
