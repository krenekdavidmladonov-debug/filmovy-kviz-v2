import { MigrationValidationError } from './errors.js';
import type { JsonObject, V1LibrarySnapshot, V1LibraryDocument } from './types.js';

export const slideFields = [
  'title', 'text', 'type', 'roundHeader', 'options', 'optionsStr', 'correct', 'correctAnswer',
  'note', 'bgImage', 'answerImg', 'media', 'mediaRaw', 'videoStart', 'videoEnd', 'audioTrigger',
  'bgOverlay', 'answerOverlay', 'qCount', 'recapOverrides', 'bgRaw', 'id',
] as const;
export const slideArrayKeys = ['slides', 'quiz', 'items', 'questions'] as const;
const scalar = (v: unknown): v is string | number | boolean | null =>
  v === null || typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v));
export function object(v: unknown): JsonObject {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new MigrationValidationError('Expected quiz-content object.');
  return v as JsonObject;
}
function pickScalars(value: unknown, fields: readonly string[]): JsonObject {
  const input = object(value); const result: JsonObject = {};
  for (const key of fields) {
    if (input[key] === undefined) continue;
    if (!scalar(input[key])) throw new MigrationValidationError('Invalid supported quiz-content scalar.');
    result[key] = input[key];
  }
  return result;
}
export function sanitizeSlide(value: unknown): JsonObject {
  const input = object(value);
  const nested = new Set(['options', 'correct', 'correctAnswer', 'media', 'recapOverrides']);
  const out = pickScalars(input, slideFields.filter(f => !nested.has(f)));
  for (const key of ['options', 'correct', 'correctAnswer']) {
    const v = input[key];
    if (v === undefined) continue;
    if (scalar(v)) out[key] = v;
    else if (Array.isArray(v) && v.every(scalar)) out[key] = [...v];
    else throw new MigrationValidationError('Unsupported structured options/answer; no content was exported.');
  }
  if (input.media !== undefined) {
    out.media = input.media === null ? null : pickScalars(input.media, ['src', 'type']);
  }
  if (input.recapOverrides !== undefined) {
    if (!Array.isArray(input.recapOverrides)) throw new MigrationValidationError('Unsupported recap overrides.');
    out.recapOverrides = input.recapOverrides.map(v => pickScalars(v, ['extraText', 'overrideMedia']));
  }
  return out;
}
export function sanitizeMetadata(value: unknown): JsonObject {
  const input = object(value); const out = pickScalars(input, ['name', 'title', 'description', 'position', 'order']);
  if (input.data !== undefined) {
    const data = object(input.data);
    if (data.settings !== undefined) out.data = { settings: pickScalars(data.settings, ['defaultAudioTrigger', 'scaleTitle', 'time_R1']) };
  }
  return out;
}
export function sanitizeLibrary(snapshot: V1LibrarySnapshot): V1LibrarySnapshot {
  if (snapshot.schemaVersion !== 1 || snapshot.collection !== 'library' || !Array.isArray(snapshot.documents)) {
    throw new MigrationValidationError('Invalid library snapshot.');
  }
  const ids = new Set<string>();
  return { schemaVersion: 1, collection: 'library', documents: snapshot.documents.map((doc: V1LibraryDocument) => {
    assertId(doc.id); if (ids.has(doc.id)) throw new MigrationValidationError('Duplicate source ID.'); ids.add(doc.id);
    const input = object(doc.data); const data = sanitizeMetadata(input);
    const nested = input.data === undefined ? undefined : object(input.data);
    const candidates = [input, ...(nested ? [nested] : [])].flatMap(container =>
      slideArrayKeys.filter(key => container[key] !== undefined).map(key => container[key]));
    if (candidates.length !== 1 || !Array.isArray(candidates[0])) throw new MigrationValidationError('Ambiguous or missing source slide array.');
    data.slides = candidates[0].map(sanitizeSlide);
    return { id: doc.id, data };
  }) };
}
export function assertId(id: unknown): asserts id is string {
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/u.test(id)) throw new MigrationValidationError('Unsafe document ID.');
}
