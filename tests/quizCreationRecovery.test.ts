import { expect, test } from 'vitest';
import { loadCreationAttempt, persistCreationAttempt, clearCreationAttempt, newCreationAttempt } from '../apps/web/src/routes/admin/quizCreationRecovery';
import { quizCreationIdentity } from '../functions/src/editor/model';

function storage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}
test('committed but lost creation restores the submitted request and retries the original quiz without duplication', () => {
  const store = storage(), roots = new Map<string, {title: string; quizId: string}>();
  const attempted = {...loadCreationAttempt('actor-a', store), submittedTitle: 'Synthetic quiz'};
  persistCreationAttempt(attempted, store);
  const commit = (request: typeof attempted) => {
    const existing = roots.get(request.requestId);
    if (existing && existing.title !== request.submittedTitle) throw Error('already-exists');
    const result = existing ?? {title: request.submittedTitle, quizId: 'original-quiz'};
    roots.set(request.requestId, result); return result;
  };
  const committed = commit(attempted); // Response is lost; no success cleanup.
  const restored = loadCreationAttempt('actor-a', store);
  expect(restored).toEqual(attempted);
  expect(commit(restored as typeof attempted)).toEqual(committed);
  expect(roots.size).toBe(1);
  clearCreationAttempt(restored, store);
  expect(loadCreationAttempt('actor-a', store).requestId).not.toBe(attempted.requestId);
});
test('only deliberate reset changes an ambiguous attempt; same-user remount keeps original title', () => {
  const store = storage(), prior = {...loadCreationAttempt('actor-a', store), submittedTitle: 'Original'};
  persistCreationAttempt(prior, store);
  expect(loadCreationAttempt('actor-a', store)).toEqual(prior);
  const fresh = newCreationAttempt('actor-a'); persistCreationAttempt(fresh, store);
  expect(fresh.requestId).not.toBe(prior.requestId); expect(fresh.submittedTitle).toBeNull();
  clearCreationAttempt(prior, store); // Late old response cannot clear the fresh attempt.
  expect(loadCreationAttempt('actor-a', store)).toEqual(fresh);
});
test('identity switch never restores another user title or lets their late success clear current state', () => {
  const store = storage(), first = {...loadCreationAttempt('actor-a', store), submittedTitle: 'Private previous title'};
  persistCreationAttempt(first, store);
  const second = loadCreationAttempt('actor-b', store);
  expect(second.actorUid).toBe('actor-b'); expect(second.submittedTitle).toBeNull();
  expect(second.requestId).not.toBe(first.requestId); clearCreationAttempt(first, store);
  expect(loadCreationAttempt('actor-b', store)).toEqual(second);
});
test('denied storage retains the in-memory retry and cleanup is harmless; malformed records are ignored', () => {
  const denied = {getItem: () => { throw Error('denied'); }, setItem: () => { throw Error('denied'); }, removeItem: () => { throw Error('denied'); }};
  const initial = loadCreationAttempt('actor-a', denied), attempted = {...initial, submittedTitle: 'Retained in memory'};
  expect(() => persistCreationAttempt(attempted, denied)).not.toThrow();
  expect(attempted.requestId).toBe(initial.requestId); expect(() => clearCreationAttempt(attempted, denied)).not.toThrow();
  const broken = { ...storage(), getItem: () => '{invalid json' };
  expect(loadCreationAttempt('actor-a', broken).submittedTitle).toBeNull();
});

test('deployed legacy ID is adopted without changing the backend identity after a committed lost response', () => {
  const store = storage(), legacyId = 'deployed-committed-request';
  store.setItem('justkviz.quiz-create-request-id', legacyId);
  const original = quizCreationIdentity('actor-a', legacyId, 'Original submitted title');
  const adopted = loadCreationAttempt('actor-a', store);
  expect(adopted).toEqual({actorUid: 'actor-a', requestId: legacyId, submittedTitle: null});
  expect(quizCreationIdentity('actor-a', adopted.requestId, 'Original submitted title')).toEqual(original);
  expect(loadCreationAttempt('actor-a', store)).toEqual(adopted);
  expect(store.getItem('justkviz.quiz-create-request-id')).toBeNull();
});
test('failed legacy adoption persistence keeps its durable ID; foreign scoped records and malformed legacy are not adopted', () => {
  const store = storage(); store.setItem('justkviz.quiz-create-request-id', 'durable-legacy');
  const deniedWrite = {...store, setItem: () => { throw Error('denied'); }};
  expect(loadCreationAttempt('actor-a', deniedWrite).requestId).toBe('durable-legacy');
  expect(store.getItem('justkviz.quiz-create-request-id')).toBe('durable-legacy');
  expect(loadCreationAttempt('actor-a', deniedWrite).requestId).toBe('durable-legacy');
  persistCreationAttempt({...newCreationAttempt('actor-b'), submittedTitle: 'Private other title'}, store);
  const own = loadCreationAttempt('actor-a', store);
  expect(own.requestId).not.toBe('durable-legacy'); expect(own.submittedTitle).toBeNull();
  const malformed = storage(); malformed.setItem('justkviz.quiz-create-request-id', 'bad/request');
  expect(loadCreationAttempt('actor-a', malformed).requestId).not.toBe('bad/request');
});
