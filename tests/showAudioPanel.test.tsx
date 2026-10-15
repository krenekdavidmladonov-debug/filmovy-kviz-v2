// @vitest-environment happy-dom
import React, { StrictMode, act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, test, vi } from 'vitest';
import { ShowAudioPanel } from '../apps/web/src/features/show-audio/ShowAudioPanel';
import type { ShowAudioController } from '../apps/web/src/features/show-audio/controller';

const fixture = vi.hoisted(() => ({
  preferences: { schemaVersion: 1, motion: 'subtle', lowerRanks: 'step', topThree: true, winnerAnimation: true,
    audioEnabled: true, volume: .25, fadeInMs: 0, fadeOutMs: 0, cues: { intro: 'quiz-asset:q/' + 'a'.repeat(64) } },
  starts: 0, active: 0, peak: 0, outputs: 0,
}));
vi.mock('../apps/web/src/features/show-audio/api', () => ({
  readEventShowPreferences: () => Promise.resolve({ eventId: 'e', revision: 1, preferences: fixture.preferences }),
  readEventShowAudio: () => Promise.resolve(new Blob(['synthetic audio'])),
  configureEventShow: vi.fn(),
}));
vi.mock('../apps/web/src/features/show-audio/ShowAudioAssetPicker', () => ({ ShowAudioAssetPicker: () => null }));
vi.mock('../apps/web/src/services/firebase/auth', () => ({ getFirebaseAuth: () => ({}) }));
vi.mock('firebase/auth', () => ({ onAuthStateChanged: (_auth: unknown, receive: () => void) => {
  void _auth; let active = true; queueMicrotask(() => { if (active) receive(); }); return () => { active = false; };
} }));
class MockAudioContext {
  state = 'running'; currentTime = 0; destination = {}; onstatechange = null;
  resume() { return Promise.resolve(); }
  close() { return Promise.resolve(); }
  decodeAudioData() { return Promise.resolve({ duration: 5 }); }
  createGain() {
    let connected = false;
    return { gain: { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, cancelScheduledValues() {} },
      connect() { connected = true; fixture.outputs++; }, disconnect() { if (connected) fixture.outputs--; connected = false; } };
  }
  createBufferSource() {
    let active = false;
    return { onended: null, buffer: null, loop: false, connect() {}, disconnect() {},
      start() { active = true; fixture.starts++; fixture.active++; fixture.peak = Math.max(fixture.peak, fixture.active); },
      stop() { if (active) fixture.active--; active = false; } };
  }
}
afterEach(() => { vi.unstubAllGlobals(); fixture.starts = 0; fixture.active = 0; fixture.peak = 0; fixture.outputs = 0; });

test('StrictMode reacquires a controller after effect cleanup, plays once and permanently invalidates released instances', async () => {
  vi.stubGlobal('AudioContext', MockAudioContext); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('React', React);
  const element = document.createElement('div'); document.body.append(element); const root = createRoot(element);
  const acquired: ShowAudioController[] = []; let allowed = true;
  try {
    await act(async () => { root.render(<StrictMode><ShowAudioPanel eventId="e" quizId="q" canPlay={() => allowed} onController={controller => { if (controller) acquired.push(controller); }} /></StrictMode>); });
    await act(async () => { await vi.waitFor(() => expect(element.querySelector('.show-audio-panel')?.getAttribute('data-save-state')).toBe('ready')); });
    expect(acquired).toHaveLength(2); expect(acquired[0]).not.toBe(acquired[1]); expect(fixture.starts).toBe(0);
    const released = acquired[0]!, current = acquired[1]!;
    await act(async () => { await released.playCue('intro', released.prepareGesture()); });
    expect(fixture.starts).toBe(0);
    await act(async () => { await current.playCue('intro', current.prepareGesture()); });
    expect(fixture.starts).toBe(1); expect(fixture.active).toBe(1); expect(fixture.outputs).toBe(1);
    // Same external media guard is still enforced on the live instance after StrictMode setup.
    allowed = false;
    await act(async () => { await current.playCue('intro', current.prepareGesture()); });
    expect(fixture.starts).toBe(1); expect(fixture.active).toBe(0);
    allowed = true;
    await act(async () => { await current.playCue('intro', current.prepareGesture()); });
    expect(fixture.starts).toBe(2); expect(fixture.peak).toBe(1);
    await act(async () => { root.unmount(); });
    expect(fixture.active).toBe(0); expect(fixture.outputs).toBe(0);
    await current.playCue('intro', current.prepareGesture()); expect(fixture.starts).toBe(2);
  } finally { if (element.isConnected) { await act(async () => { root.unmount(); }); element.remove(); } }
});
