import { afterEach, expect, test, vi } from 'vitest';
import { Fanfare } from '../apps/web/src/features/final-reveal/fanfare';
let starts = 0, stops = 0;
class FakeAudio {
  state = 'running'; currentTime = 0; destination = {};
  resume = vi.fn(async () => {}); close = vi.fn(async () => {});
  createGain() { return { gain: { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, disconnect() {} }; }
  createOscillator() { return { type: '', frequency: { value: 0 }, onended: null, start() { starts++; }, stop() { stops++; }, connect() {}, disconnect() {} }; }
}
afterEach(() => { vi.unstubAllGlobals(); starts = 0; stops = 0; });
test('gesture preparation is silent; duplicate key and denied authority never schedule sound', async () => {
  vi.stubGlobal('AudioContext', FakeAudio); const changed = vi.fn(), f = new Fanfare(changed);
  f.prepare(); expect(starts).toBe(0);
  await f.play('denied', () => false); expect(starts).toBe(0);
  await f.play('winner', () => true); expect(starts).toBe(7); expect(changed).toHaveBeenLastCalledWith('playing');
  await f.play('winner', () => true); expect(starts).toBe(7);
  f.setVolume(.2, true); f.stop(); expect(stops).toBeGreaterThanOrEqual(7); expect(changed).toHaveBeenLastCalledWith('idle'); f.dispose();
});
test('rejected playback reports fallback; only a new manual key retries it', async () => {
  let denied = true;
  class Blocked extends FakeAudio { override resume = vi.fn(() => denied ? Promise.reject(Error('NotAllowedError')) : Promise.resolve()); }
  vi.stubGlobal('AudioContext', Blocked); const changed = vi.fn(), f = new Fanfare(changed);
  await f.play('auto', () => true); expect(starts).toBe(0); expect(changed).toHaveBeenLastCalledWith('blocked');
  denied = false; await f.play('auto', () => true); expect(starts).toBe(0);
  f.prepare(); await f.play('manual', () => true); expect(starts).toBe(7); f.dispose();
});
test('late browser resume after STOP/dispose or revoked authority cannot play', async () => {
  let resolve!: () => void;
  class Delayed extends FakeAudio { override resume = vi.fn(() => new Promise<void>(r => { resolve = r; })); }
  vi.stubGlobal('AudioContext', Delayed); const f = new Fanfare(vi.fn());
  const pending = f.play('winner', () => true); f.stop(); resolve(); await pending; expect(starts).toBe(0);
  let allowed = true; const next = f.play('manual', () => allowed); allowed = false; resolve(); await next; expect(starts).toBe(0); f.dispose();
});
