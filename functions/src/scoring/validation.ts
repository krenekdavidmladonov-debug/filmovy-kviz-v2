import { HttpsError } from 'firebase-functions/v2/https';
import { isObject, requiredId } from '../events/validation.js';

export function parseScoreRequest(data: unknown) {
  const fields = ['eventId', 'snapshotId', 'teamId', 'roundId', 'requestId', 'expectedRevision', 'halfPoints', 'reason'];
  if (!isObject(data) || Object.keys(data).some(key => !fields.includes(key))) {
    throw new HttpsError('invalid-argument', 'Unsupported score request.');
  }
  const ids = Object.fromEntries(['eventId', 'snapshotId', 'teamId', 'roundId', 'requestId'].map(field => {
    const id = requiredId(data, field);
    if (Buffer.byteLength(id, 'utf8') > 500 || id === '.' || id === '..') throw new HttpsError('invalid-argument', 'Invalid identifier.');
    return [field, id];
  })) as Record<'eventId' | 'snapshotId' | 'teamId' | 'roundId' | 'requestId', string>;
  if (!Number.isSafeInteger(data.expectedRevision) || (data.expectedRevision as number) < 0
    || (data.expectedRevision as number) >= Number.MAX_SAFE_INTEGER) {
    throw new HttpsError('invalid-argument', 'Invalid expected revision.');
  }
  if (data.halfPoints !== null && (!Number.isSafeInteger(data.halfPoints) || (data.halfPoints as number) < 0)) {
    throw new HttpsError('invalid-argument', 'Points must be safe non-negative integer half-point units or null.');
  }
  if (typeof data.reason !== 'string' || data.reason.length > 300 || /[\p{Cc}\p{Cf}]/u.test(data.reason)) {
    throw new HttpsError('invalid-argument', 'Reason must be at most 300 characters.');
  }
  return { ...ids, expectedRevision: data.expectedRevision as number, halfPoints: data.halfPoints as number | null, reason: data.reason.trim() };
}
