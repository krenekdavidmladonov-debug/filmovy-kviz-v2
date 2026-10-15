import { afterEach, expect, test, vi } from 'vitest';
import { normalizeShowPreferences, quizAssetReference, type ShowPreferences } from '../packages/quiz-domain/src/index';
import { ShowAudioController, type ShowAudioState } from '../apps/web/src/features/show-audio/controller';

const reference = quizAssetReference('q', 'a'.repeat(64));
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; };
class Context {
  state = 'running'; currentTime = 0; destination = {}; starts = 0; stops = 0; connected = 0;
  gains: { value: number; setValueAtTime: ReturnType<typeof vi.fn>; linearRampToValueAtTime: ReturnType<typeof vi.fn>; cancelScheduledValues: ReturnType<typeof vi.fn> }[] = [];
  resume = vi.fn(() => Promise.resolve()); close = vi.fn(() => Promise.resolve());
  decodeAudioData = vi.fn(() => Promise.resolve({ duration: 5 }));
  createGain() {
    const gain = { value: 0, setValueAtTime: vi.fn((value: number) => { gain.value = value; }), linearRampToValueAtTime: vi.fn(), cancelScheduledValues: vi.fn() };
    this.gains.push(gain);
    return { gain, connect: () => { this.connected++; }, disconnect: () => { this.connected--; } };
  }
  createBufferSource() { return { buffer: null, loop: true, onended: null, connect() {}, disconnect() {}, start: () => { this.starts++; }, stop: () => { this.stops++; } }; }
}
function setup(read: (reference: string, signal: AbortSignal) => Promise<Blob> = vi.fn(() => Promise.resolve(new Blob(['synthetic'])))) {
  let preferences: ShowPreferences = { ...normalizeShowPreferences(undefined), audioEnabled: true, cues: { intro: reference, winner: reference } };
  const ctx = new Context(), states: ShowAudioState[] = [], allowed = { value: true };
  const controller = new ShowAudioController({ context: () => ctx as unknown as AudioContext, preferences: () => preferences, read,
    changed: state => states.push(state), allowed: () => allowed.value });
  return { controller, ctx, states, read, allowed, setPreferences: (p: ShowPreferences) => { preferences = p; }, preferences: () => preferences };
}
afterEach(() => vi.useRealTimers());
test('prepare is silent; each fresh token plays once after decode with bounded gain and no loop', async () => {
  const t = setup(), token = t.controller.prepareGesture(); expect(t.ctx.starts).toBe(0);
  await t.controller.playCue('winner', token); expect(t.ctx.decodeAudioData).toHaveBeenCalledOnce();
  expect(t.ctx.starts).toBe(1); expect(t.ctx.connected).toBe(1); expect(t.states.at(-1)).toEqual({ status: 'playing', cue: 'winner' });
  expect(t.ctx.gains[0]!.linearRampToValueAtTime).toHaveBeenCalledWith(.25, .3);
  await t.controller.playCue('winner', token); expect(t.ctx.starts).toBe(1);
  t.controller.stopImmediate(); expect(t.ctx.connected).toBe(0); expect(t.ctx.stops).toBe(1); t.controller.dispose();
});
test('STOP before late download aborts it and cannot replay even with same token', async () => {
  const d = deferred<Blob>(), read = vi.fn((reference: string, signal: AbortSignal) => { void reference; void signal; return d.promise; }), t = setup(read);
  const token = t.controller.prepareGesture(), pending = t.controller.playCue('intro', token);
  await vi.waitFor(() => expect(read).toHaveBeenCalledOnce()); t.controller.stopImmediate();
  expect(read.mock.calls[0]![1].aborted).toBe(true); d.resolve(new Blob(['late'])); await pending;
  expect(t.ctx.starts).toBe(0); await t.controller.playCue('intro', token); expect(t.ctx.starts).toBe(0); t.controller.dispose();
});
test('STOP and revoked authority during decode cannot schedule an output', async () => {
  for (const action of ['stop', 'revoke', 'replace', 'dispose']) {
    const d = deferred<{ duration: number }>(), t = setup(); t.ctx.decodeAudioData = vi.fn(() => d.promise);
    const token = t.controller.prepareGesture(), pending = t.controller.playCue('intro', token);
    await vi.waitFor(() => expect(t.ctx.decodeAudioData).toHaveBeenCalledOnce());
    if (action === 'stop') t.controller.stopImmediate();
    if (action === 'revoke') t.allowed.value = false;
    if (action === 'replace') t.setPreferences({ ...t.preferences(), cues: {} });
    if (action === 'dispose') t.controller.dispose();
    d.resolve({ duration: 5 }); await pending; expect(t.ctx.starts).toBe(0); expect(t.ctx.connected).toBe(0); t.controller.dispose();
  }
});
test('late browser resume after STOP never downloads or starts a source', async () => {
  const t = setup(), d = deferred<void>(); t.ctx.resume = vi.fn(() => d.promise);
  const token = t.controller.prepareGesture(), pending = t.controller.playCue('winner', token);
  t.controller.stopImmediate(); d.resolve(); await pending;
  expect(t.read).not.toHaveBeenCalled(); expect(t.ctx.starts).toBe(0); t.controller.dispose();
});
test('disabled, zero volume, missing cue and media guard do not fetch or play', async () => {
  const t = setup();
  for (const patch of [{ audioEnabled: false }, { volume: 0 }, { cues: {} }]) {
    t.setPreferences({ ...normalizeShowPreferences(undefined), audioEnabled: true, cues: { intro: reference }, ...patch });
    await t.controller.playCue('intro', t.controller.prepareGesture());
  }
  t.allowed.value = false; await t.controller.playCue('winner', t.controller.prepareGesture());
  expect(t.read).not.toHaveBeenCalled(); expect(t.ctx.starts).toBe(0); t.controller.dispose();
});
test('autoplay denial requires a new explicit gesture; a retry never reuses consumed token', async () => {
  const t = setup(); t.ctx.resume = vi.fn(() => Promise.reject(new DOMException('denied', 'NotAllowedError')));
  const token = t.controller.prepareGesture(); await t.controller.playCue('winner', token);
  expect(t.states.at(-1)?.status).toBe('blocked'); expect(t.ctx.starts).toBe(0);
  t.ctx.resume = vi.fn(() => Promise.resolve()); await t.controller.playCue('winner', token); expect(t.ctx.starts).toBe(0);
  await t.controller.playCue('winner', t.controller.prepareGesture()); expect(t.ctx.starts).toBe(1); t.controller.dispose();
});
test('fade stop and live mute touch active gain; a new cue cancels old fade and preserves one output', async () => {
  vi.useFakeTimers(); const t = setup(); await t.controller.playCue('intro', t.controller.prepareGesture());
  t.setPreferences({ ...t.preferences(), volume: 0 }); t.controller.updateVolume(); expect(t.ctx.gains[0]!.setValueAtTime).toHaveBeenLastCalledWith(0, 0);
  t.setPreferences({ ...t.preferences(), volume: .4 }); t.controller.updateVolume(); t.controller.stop();
  expect(t.ctx.gains[0]!.linearRampToValueAtTime).toHaveBeenLastCalledWith(0, .5);
  await t.controller.playCue('winner', t.controller.prepareGesture()); expect(t.ctx.connected).toBe(1);
  await vi.advanceTimersByTimeAsync(500); expect(t.ctx.connected).toBe(1); t.controller.dispose(); expect(t.ctx.connected).toBe(0);
});
