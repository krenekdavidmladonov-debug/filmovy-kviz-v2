import { beforeEach, expect, test, vi } from 'vitest';
import { normalizeShowPreferences, quizAssetReference } from '../packages/quiz-domain/src/index';
import { eventShowAudioAllowed, readyShowAudio, requestedShowPreferences } from '../functions/src/show-mode/audio-model';
import { publicMediaAllowed } from '../functions/src/media/model';
import { authorizeEventShowMedia } from '../functions/src/access/media';
const gateway = vi.hoisted(() => {
  const records: Record<string, Record<string, unknown>> = {};
  return {
  records,
  denied: false,
  authorize: vi.fn((auth: unknown) => {
    if (!auth || gateway.denied) throw new Error('denied');
    return Promise.resolve({ version: 1 });
  }),
}; });
vi.mock('../functions/src/access/authorization', async importOriginal => ({ ...await importOriginal<object>(), authorize: gateway.authorize, freshIdentity: vi.fn() }));
vi.mock('../functions/node_modules/firebase-admin/lib/esm/firestore/index.js', async () => ({ ...await import('../functions/node_modules/firebase-admin/lib/firestore/index.js'), getFirestore: () => ({
  doc: (path: string) => ({ path }),
  runTransaction: (run: (tx: unknown) => unknown) => run({ get: (ref: { path: string }) => Promise.resolve({ data: () => gateway.records[ref.path] }) }),
}) }));
const reference = quizAssetReference('q', 'a'.repeat(64)), other = quizAssetReference('q', 'b'.repeat(64));
const asset = { quizId: 'q', status: 'ready', generation: '123', kind: 'audio', contentType: 'audio/wav', size: 512 };
const prefs = { ...normalizeShowPreferences(undefined), audioEnabled: true, cues: { intro: reference } };
const event = { showPreferences: prefs, showAudioBindings: { intro: { reference, generation: '123' } } };
beforeEach(() => { gateway.records = {}; gateway.denied = false; gateway.authorize.mockClear(); });
test('five user cues only, complete strict preferences, no URL/legacy rank cues or invalid volume/fades', () => {
  expect(requestedShowPreferences(prefs)).toEqual(prefs);
  for (const patch of [{ cues: { third: reference } }, { cues: { winner: 'https://example.test/music.mp3' } }, { volume: 1.1 }, { volume: NaN }, { fadeInMs: 2001 }, { fadeOutMs: -1 }, { schemaVersion: 2 }, { privateRows: [] }]) expect(() => requestedShowPreferences({ ...prefs, ...patch })).toThrow();
  expect(() => requestedShowPreferences(undefined)).toThrow();
});
test('event media needs exact current cue, frozen generation and ready bounded MP3/WAV', () => {
  expect(eventShowAudioAllowed(event, reference, asset)).toBe(true);
  expect(eventShowAudioAllowed(event, other, asset)).toBe(false);
  expect(eventShowAudioAllowed({ ...event, showPreferences: { ...prefs, cues: {} } }, reference, asset)).toBe(false);
  expect(eventShowAudioAllowed({ ...event, showAudioBindings: {} }, reference, asset)).toBe(false);
  for (const patch of [{ generation: '124' }, { status: 'uploading' }, { quizId: 'foreign' }, { kind: 'image' }, { contentType: 'audio/ogg' }, { size: 26214401 }, { generation: '' }]) expect(eventShowAudioAllowed(event, reference, { ...asset, ...patch })).toBe(false);
  expect(readyShowAudio(reference, asset)).toEqual({ reference, generation: '123' });
});
test('interim backdrop authorizes only allowlisted current images, never sound or extras', () => {
  const publication = { status: 'active', interimResults: {}, interimBackdrop: { renderMode: 'question', slideKind: 'image', title: 'Safe', text: '', questionImage: reference, design: { backgroundImage: other } } };
  expect(publicMediaAllowed(publication, reference, 'image')).toBe(true);
  expect(publicMediaAllowed(publication, other, 'image')).toBe(true);
  expect(publicMediaAllowed(publication, reference, 'audio')).toBe(false);
  expect(publicMediaAllowed({ ...publication, status: 'ended' }, reference, 'image')).toBe(false);
  expect(publicMediaAllowed({ ...publication, interimBackdrop: { ...publication.interimBackdrop, answerImage: reference } }, reference, 'image')).toBe(false);
  expect(publicMediaAllowed({ ...publication, interimBackdrop: { ...publication.interimBackdrop, slideKind: 'audio', mediaSource: reference } }, reference, 'audio')).toBe(false);
});
test('event gateway requires current event.live/scope in transaction and rechecking observes revocation/removal/generation change', async () => {
  const auth = { uid: 'u', token: { email_verified: true, auth_time: 1 } } as Parameters<typeof authorizeEventShowMedia>[0];
  gateway.records = { 'events/e': { ...event, disposition: 'active', lifecycleStatus: 'draft' }, ['quizzes/q/mediaAssets/' + 'a'.repeat(64)]: asset };
  await expect(authorizeEventShowMedia(auth, 'e', reference)).resolves.toBe('123');
  expect(gateway.authorize).toHaveBeenCalledWith(auth, ['event.live'], { kind: 'event', id: 'e' }, expect.anything());
  await expect(authorizeEventShowMedia(undefined, 'e', reference)).rejects.toThrow();
  gateway.denied = true; await expect(authorizeEventShowMedia(auth, 'e', reference)).rejects.toThrow(); gateway.denied = false;
  gateway.records['events/e'] = { ...event, showPreferences: { ...prefs, cues: {} } };
  await expect(authorizeEventShowMedia(auth, 'e', reference)).rejects.toThrow();
  gateway.records['events/e'] = event;
  gateway.records['quizzes/q/mediaAssets/' + 'a'.repeat(64)] = { ...asset, generation: '999' };
  await expect(authorizeEventShowMedia(auth, 'e', reference)).rejects.toThrow();
  gateway.records['quizzes/q/mediaAssets/' + 'a'.repeat(64)] = asset;
  gateway.records['events/e'] = { ...event, lifecycleStatus: 'cancelled' };
  await expect(authorizeEventShowMedia(auth, 'e', reference)).rejects.toThrow();
});
