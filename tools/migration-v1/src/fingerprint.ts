import { createHash } from 'node:crypto';
import type { JsonObject, V2QuizDocument } from './types.js';

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, v]) => JSON.stringify(key) + ':' + canonical(v)).join(',') + '}';
  if (value === undefined || (typeof value === 'number' && !Number.isFinite(value))) throw new Error('Non-canonical value.');
  return JSON.stringify(value);
}
export const fingerprint = (value: unknown): string => createHash('sha256').update(canonical(value)).digest('hex');
const ignored = new Set(['createdAt', 'updatedAt', 'createdBy', 'updatedBy', 'revision']);
function content(data: JsonObject): JsonObject {
  return Object.fromEntries(Object.entries(data).filter(([key]) => !ignored.has(key)).map(([key, value]) => [
    key, key === 'legacy' && value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).filter(([k]) => !['sourceProject', 'sourceCollection', 'sourceId', 'exportFingerprint', 'transformVersion', 'contentFingerprint'].includes(k)))
      : value,
  ]));
}
export function contentFingerprint(quiz: V2QuizDocument): string {
  const byId = <T extends { id: string }>(items: readonly T[]) => [...items].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  return fingerprint({ id: quiz.id, data: content(quiz.data),
    slides: byId(quiz.slides).map(s => ({ id: s.id, data: content(s.data) })),
    rounds: byId(quiz.rounds).map(r => ({ id: r.id, data: content(r.data),
      questions: byId(r.questions).map(q => ({ id: q.id, data: content(q.data) })) })),
  });
}
