const storageKey = 'justkviz.quiz-create-attempt';
const legacyStorageKey = 'justkviz.quiz-create-request-id';
export interface CreationAttempt {
  readonly actorUid: string;
  readonly requestId: string;
  readonly submittedTitle: string | null;
}
type AttemptStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
function sessionStore(): AttemptStorage | undefined {
  try { return window.sessionStorage; } catch { return undefined; }
}
export function newCreationAttempt(actorUid: string): CreationAttempt {
  return {actorUid, requestId: crypto.randomUUID(), submittedTitle: null};
}
export function persistCreationAttempt(attempt: CreationAttempt, storage = sessionStore()): boolean {
  try {
    if (!storage) return false;
    const serialized = JSON.stringify(attempt);
    storage.setItem(storageKey, serialized); return storage.getItem(storageKey) === serialized;
  } catch { return false; /* Same-page retries retain the in-memory attempt. */ }
}
export function loadCreationAttempt(actorUid: string, storage = sessionStore()): CreationAttempt {
  try {
    const raw = storage?.getItem(storageKey);
    // The deployed version stored only an ID. Keep it on upgrade: its original
    // title is unknown, but repeating the original title must address the same
    // actor-bound backend quiz. Never adopt it over another actor's record.
    if (raw === null) {
      const legacy = storage?.getItem(legacyStorageKey);
      if (typeof legacy === 'string' && /^[\w-]{1,150}$/u.test(legacy)) {
        const adopted = {actorUid, requestId: legacy, submittedTitle: null};
        if (persistCreationAttempt(adopted, storage)) {
          try { storage?.removeItem(legacyStorageKey); } catch { /* The adopted record remains authoritative. */ }
        }
        return adopted;
      }
    }
    const value: unknown = raw ? JSON.parse(raw) : null;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const candidate = value as Record<string, unknown>;
      if (Object.keys(candidate).sort().join(',') === 'actorUid,requestId,submittedTitle'
        && candidate.actorUid === actorUid && typeof candidate.requestId === 'string' && /^[\w-]{1,150}$/u.test(candidate.requestId)
        && (candidate.submittedTitle === null || (typeof candidate.submittedTitle === 'string'
          && candidate.submittedTitle.trim() === candidate.submittedTitle && candidate.submittedTitle.length > 0 && candidate.submittedTitle.length <= 300))) {
        return candidate as unknown as CreationAttempt;
      }
    }
  } catch { /* Unavailable or malformed storage cannot expose a previous user's draft. */ }
  const fresh = newCreationAttempt(actorUid); persistCreationAttempt(fresh, storage); return fresh;
}
export function clearCreationAttempt(attempt: CreationAttempt, storage = sessionStore()): void {
  try {
    const raw = storage?.getItem(storageKey);
    const value: unknown = raw ? JSON.parse(raw) : null;
    if (value && typeof value === 'object' && 'actorUid' in value && 'requestId' in value
      && value.actorUid === attempt.actorUid && value.requestId === attempt.requestId) storage?.removeItem(storageKey);
    if (storage?.getItem(legacyStorageKey) === attempt.requestId) storage.removeItem(legacyStorageKey);
  } catch { /* Successful creation is unaffected by storage availability. */ }
}
