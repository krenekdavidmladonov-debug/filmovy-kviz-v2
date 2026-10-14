// @vitest-environment happy-dom

import React, { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { SlideRenderer } from '../apps/web/src/features/presentation/SlideRenderer';
import { YouTubePlayer } from '../apps/web/src/features/presentation/YouTubePlayer';
import {
  openOrFocusProjector,
  projectorFullscreenFailureMessage,
  projectorPopupBlockedMessage,
  requestProjectorFullscreen,
} from '../apps/web/src/features/live/projectorWindow';
import type { MediaPlaybackState } from '../apps/web/src/features/presentation/types';

interface FakePlayerEvents {
  readonly onReady: () => void;
  readonly onStateChange: (event: { data: number }) => void;
  readonly onError: () => void;
  readonly onAutoplayBlocked?: () => void;
}

class FakePlayer {
  static instances: FakePlayer[] = [];
  readonly events: FakePlayerEvents;
  readonly destroy = vi.fn();
  readonly cueVideoById = vi.fn();
  readonly loadVideoById = vi.fn();
  readonly playVideo = vi.fn();
  readonly pauseVideo = vi.fn();
  readonly seekTo = vi.fn();

  constructor(_element: HTMLElement, options: { readonly events: FakePlayerEvents }) {
    this.events = options.events;
    FakePlayer.instances.push(this);
  }
}

class DomReplacingFakePlayer extends FakePlayer {
  constructor(element: HTMLElement, options: { readonly events: FakePlayerEvents }) {
    super(element, options);
    element.replaceWith(document.createElement('iframe'));
  }
}

function installFakeYouTube(): void {
  Object.assign(window, {
    YT: {
      Player: FakePlayer,
      PlayerState: { ENDED: 0, PLAYING: 1 },
    },
  });
}

async function mounted(element: React.ReactNode): Promise<{ readonly host: HTMLElement; readonly root: Root }> {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => { root.render(element); });
  return { host, root };
}

function AudioLifecycleHarness() {
  const [playbackState, setPlaybackState] = useState<MediaPlaybackState>('preparing');
  return (
    <>
      <YouTubePlayer
        source="abcdefghijk"
        command="play"
        generation={30}
        startSeconds={0}
        onPlaybackState={(_generation, state) => setPlaybackState(state)}
        onError={() => setPlaybackState('error')}
        onFinished={() => setPlaybackState('finished')}
      />
      <SlideRenderer
        quizTitle="Syntetický kvíz"
        mediaCommand="play"
        mediaPlaybackState={playbackState}
        mediaGeneration={30}
        slide={{ kind: 'audio', title: 'Audio otázka', text: '', options: [], media: [] }}
      />
    </>
  );
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  FakePlayer.instances = [];
  installFakeYouTube();
  window.__FILMOVY_KVIZ_MEDIA_DEBUG__ = undefined;
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
  document.head.querySelectorAll('script[data-filmovy-kviz-youtube-api]').forEach((script) => script.remove());
});

describe('mounted media lifecycle regressions', () => {
  test('blocked projector video keeps its iframe and resumes only on a local manual gesture', async () => {
    Object.assign(window.YT!, { Player: DomReplacingFakePlayer });
    const report = vi.fn();
    const video = { kind: 'video', title: 'Veřejná otázka', text: 'Pouze zadání', options: [], media: [], mediaSource: 'abcdefghijk' };
    const view = await mounted(<SlideRenderer quizTitle="Kvíz" mediaCommand="play" mediaGeneration={2} slide={video} onMediaPlaybackState={report} />);
    const player = FakePlayer.instances[0]!;
    await act(async () => { player.events.onReady(); player.events.onAutoplayBlocked?.(); });
    expect(view.host.querySelector('iframe')).not.toBeNull();
    expect(player.destroy).not.toHaveBeenCalled();
    expect(view.host.textContent).toContain('Prohlížeč zablokoval automatické přehrání');
    expect(report.mock.calls.some(call => call[1] === 'error' || call[1] === 'playing')).toBe(false);
    const manual = [...view.host.querySelectorAll('button')].find(button => button.textContent === 'Spustit video ručně')!;
    expect(player.playVideo).not.toHaveBeenCalled();
    await act(async () => { manual.click(); });
    expect(player.playVideo).toHaveBeenCalledOnce();
    expect(view.host.querySelector('[data-media-lifecycle="PLAYING"]')).toBeNull();
    await act(async () => { player.events.onStateChange({ data: 1 }); });
    expect(view.host.querySelector('[data-media-lifecycle="PLAYING"]')).not.toBeNull();
    expect(view.host.textContent).not.toContain('Spustit video ručně');
    expect(report).toHaveBeenLastCalledWith(2, 'playing');
    await act(async () => { view.root.unmount(); });
  });

  test('provider failure remains visible after player removal and clears on stop or slide change', async () => {
    const report = vi.fn();
    const video = { kind: 'video', title: 'Veřejná otázka', text: '', options: [], media: [], mediaSource: 'abcdefghijk',
      revealedAnswer: 'PRIVATE_ANSWER_CANARY', answerExplanation: 'PRIVATE_EXPLANATION_CANARY', answerImage: 'https://example.test/private-answer.png' };
    const view = await mounted(<SlideRenderer quizTitle="Kvíz" mediaCommand="play" mediaGeneration={4} slide={video} onMediaPlaybackState={report} />);
    const failed = FakePlayer.instances[0]!;
    await act(async () => { failed.events.onError(); });
    expect(view.host.querySelector('[data-media-lifecycle]')).toBeNull();
    expect(failed.destroy).toHaveBeenCalledOnce();
    expect(view.host.querySelector('[role="status"]')?.textContent).toContain('Médium se nepodařilo přehrát');
    expect(view.host.textContent).not.toContain('PRIVATE_ANSWER_CANARY');
    expect(view.host.textContent).not.toContain('PRIVATE_EXPLANATION_CANARY');
    expect(view.host.querySelector('img[src="https://example.test/private-answer.png"]')).toBeNull();
    expect(report.mock.calls.filter(call => call[1] === 'error')).toHaveLength(1);
    await act(async () => { view.root.render(<SlideRenderer quizTitle="Kvíz" mediaCommand="stop" mediaGeneration={5} slide={video} />); });
    expect(view.host.querySelector('[role="status"]')).toBeNull();
    await act(async () => { view.root.render(<SlideRenderer quizTitle="Kvíz" mediaCommand="error" mediaPlaybackState="error" mediaGeneration={6} slide={video} />); });
    expect(view.host.querySelector('[role="status"]')).not.toBeNull();
    await act(async () => { view.root.render(<SlideRenderer quizTitle="Kvíz" mediaCommand="idle" mediaGeneration={7} slide={{ kind: 'text', title: 'Další otázka', text: '', options: [], media: [] }} />); });
    expect(view.host.querySelector('[role="status"]')).toBeNull();
    expect(view.host.textContent).toContain('Další otázka');
    await act(async () => { view.root.unmount(); });
  });

  test('blocked video manual control and late callbacks cannot restart after stop or finish', async () => {
    const report = vi.fn();
    const video = { kind: 'video', title: 'Video', text: '', options: [], media: [], mediaSource: 'abcdefghijk' };
    const view = await mounted(<SlideRenderer quizTitle="Kvíz" mediaCommand="play" mediaGeneration={8} slide={video} onMediaPlaybackState={report} />);
    const old = FakePlayer.instances[0]!;
    await act(async () => { old.events.onReady(); old.events.onAutoplayBlocked?.(); });
    const manual = [...view.host.querySelectorAll('button')].find(button => button.textContent === 'Spustit video ručně')!;
    await act(async () => { view.root.render(<SlideRenderer quizTitle="Kvíz" mediaCommand="stop" mediaGeneration={9} slide={video} onMediaPlaybackState={report} />); });
    report.mockClear();
    await act(async () => { manual.click(); old.events.onAutoplayBlocked?.(); old.events.onStateChange({ data: 1 }); });
    expect(old.playVideo).not.toHaveBeenCalled();
    expect(report).not.toHaveBeenCalled();
    expect(view.host.querySelector('[data-media-lifecycle]')).toBeNull();
    await act(async () => { view.root.render(<SlideRenderer quizTitle="Kvíz" mediaCommand="finished" mediaGeneration={10} slide={video} />); });
    expect(view.host.textContent).not.toContain('Spustit video ručně');
    expect(view.host.querySelector('[role="status"]')).toBeNull();
    await act(async () => { view.root.unmount(); });
  });

  test('a delayed ENDED from PLAY generation 10 cannot finish REPLAY generation 11', async () => {
    const finished = vi.fn();
    const view = await mounted(
      <YouTubePlayer source="abcdefghijk" command="play" generation={10} startSeconds={0} onFinished={finished} />,
    );
    const first = FakePlayer.instances[0]!;
    await act(async () => { first.events.onReady(); first.events.onStateChange({ data: 1 }); });
    const staleEnded = first.events.onStateChange;

    await act(async () => {
      view.root.render(<YouTubePlayer source="abcdefghijk" command="replay" generation={11} startSeconds={0} onFinished={finished} />);
    });
    const current = FakePlayer.instances.at(-1)!;
    await act(async () => { current.events.onReady(); current.events.onStateChange({ data: 1 }); });
    await act(async () => { staleEnded({ data: 0 }); });

    expect(finished).not.toHaveBeenCalled();
    expect(view.host.querySelector('[data-media-lifecycle]')?.getAttribute('data-media-lifecycle')).toBe('PLAYING');
    await act(async () => { view.root.unmount(); });
  });

  test('a delayed callback from slide 7 cannot alter slide 8', async () => {
    const finished = vi.fn();
    const view = await mounted(
      <YouTubePlayer source="abcdefghijk" command="play" generation={7} startSeconds={0} onFinished={finished} />,
    );
    const first = FakePlayer.instances[0]!;
    await act(async () => { first.events.onReady(); first.events.onStateChange({ data: 1 }); });

    await act(async () => {
      view.root.render(<YouTubePlayer source="lmnopqrstuv" command="play" generation={8} startSeconds={0} onFinished={finished} />);
    });
    const second = FakePlayer.instances.at(-1)!;
    await act(async () => { second.events.onReady(); second.events.onStateChange({ data: 1 }); });
    await act(async () => { first.events.onStateChange({ data: 0 }); });

    expect(finished).not.toHaveBeenCalled();
    expect(view.host.querySelector('[data-media-lifecycle]')?.getAttribute('data-media-lifecycle')).toBe('PLAYING');
    await act(async () => { view.root.unmount(); });
  });

  test('invalid VIDEO after PLAY immediately falls back to the question', async () => {
    const view = await mounted(
      <SlideRenderer
        quizTitle="Syntetický kvíz"
        mediaCommand="play"
        mediaGeneration={3}
        slide={{ kind: 'video', title: 'Bezpečná otázka', text: 'Text otázky', options: [], media: [], mediaSource: 'https://example.test/not-youtube' }}
      />,
    );
    await act(async () => undefined);
    expect(view.host.querySelector('.video-presentation')).toBeNull();
    expect(view.host.querySelector('.question-layout')).not.toBeNull();
    expect(view.host.textContent).toContain('Bezpečná otázka');
    await act(async () => { view.root.unmount(); });
  });

  test('PLAY command alone does not claim that AUDIO is actually playing', async () => {
    const view = await mounted(
      <SlideRenderer
        quizTitle="Syntetický kvíz"
        mediaCommand="play"
        mediaGeneration={4}
        slide={{ kind: 'audio', title: 'Audio otázka', text: '', options: [], media: [] }}
      />,
    );
    expect(view.host.querySelector('.vinyl-visual')?.classList.contains('is-playing')).toBe(false);
    expect(view.host.textContent).not.toContain('PŘEHRÁVÁ SE AUDIO');
    await act(async () => { view.root.unmount(); });
  });

  test('AUDIO rotates only after actual PLAYING and stops after END', async () => {
    const view = await mounted(<AudioLifecycleHarness />);
    const player = FakePlayer.instances[0]!;
    await act(async () => { player.events.onReady(); });
    expect(view.host.querySelector('.vinyl-visual')?.classList.contains('is-playing')).toBe(false);
    await act(async () => { player.events.onStateChange({ data: 1 }); });
    expect(view.host.querySelector('.vinyl-visual')?.classList.contains('is-playing')).toBe(true);
    await act(async () => { player.events.onStateChange({ data: 0 }); });
    expect(view.host.querySelector('.vinyl-visual')?.classList.contains('is-playing')).toBe(false);
    await act(async () => { view.root.unmount(); });
  });

  test('AUDIO onError and autoplay rejection both stop the vinyl', async () => {
    const errorView = await mounted(<AudioLifecycleHarness />);
    const errorPlayer = FakePlayer.instances[0]!;
    await act(async () => { errorPlayer.events.onReady(); errorPlayer.events.onStateChange({ data: 1 }); });
    expect(errorView.host.querySelector('.vinyl-visual')?.classList.contains('is-playing')).toBe(true);
    await act(async () => { errorPlayer.events.onError(); });
    expect(errorView.host.querySelector('.vinyl-visual')?.classList.contains('is-playing')).toBe(false);
    await act(async () => { errorView.root.unmount(); });

    FakePlayer.instances = [];
    const autoplayView = await mounted(<AudioLifecycleHarness />);
    const autoplayPlayer = FakePlayer.instances[0]!;
    await act(async () => { autoplayPlayer.events.onReady(); autoplayPlayer.events.onStateChange({ data: 1 }); });
    await act(async () => { autoplayPlayer.events.onAutoplayBlocked?.(); });
    expect(autoplayView.host.querySelector('.vinyl-visual')?.classList.contains('is-playing')).toBe(false);
    await act(async () => { autoplayView.root.unmount(); });
  });

  test('mounting and replacing a player never accumulates heavy instances', async () => {
    const view = await mounted(<YouTubePlayer source="abcdefghijk" command="play" generation={1} startSeconds={0} />);
    await act(async () => { view.root.render(<YouTubePlayer source="lmnopqrstuv" command="play" generation={2} startSeconds={0} />); });
    await act(async () => { view.root.unmount(); });
    expect(window.__FILMOVY_KVIZ_MEDIA_DEBUG__).toEqual({ activePlayers: 0, peakPlayers: 1, createdPlayers: 2, destroyedPlayers: 2 });
  });

  test('300 VIDEO PLAY/REPLAY/STOP operations keep at most one heavy player mounted', async () => {
    const video = {
      kind: 'video', title: 'Video otázka', text: 'Syntetické zadání', options: [], media: [], mediaSource: 'abcdefghijk',
    } as const;
    const view = await mounted(
      <SlideRenderer quizTitle="Syntetický kvíz" mediaCommand="stop" mediaGeneration={0} slide={video} />,
    );
    let operations = 0;
    for (let cycle = 1; cycle <= 100; cycle += 1) {
      await act(async () => {
        view.root.render(
          <SlideRenderer quizTitle="Syntetický kvíz" mediaCommand="play" mediaGeneration={cycle * 3 - 2} slide={video} />,
        );
      });
      operations += 1;
      const playPlayer = FakePlayer.instances.at(-1)!;
      await act(async () => { playPlayer.events.onReady(); playPlayer.events.onStateChange({ data: 1 }); });
      await act(async () => {
        view.root.render(
          <SlideRenderer quizTitle="Syntetický kvíz" mediaCommand="replay" mediaGeneration={cycle * 3 - 1} slide={video} />,
        );
      });
      operations += 1;
      const replayPlayer = FakePlayer.instances.at(-1)!;
      await act(async () => { replayPlayer.events.onReady(); replayPlayer.events.onStateChange({ data: 1 }); });
      await act(async () => {
        view.root.render(
          <SlideRenderer quizTitle="Syntetický kvíz" mediaCommand="stop" mediaGeneration={cycle * 3} slide={video} />,
        );
      });
      operations += 1;
    }
    expect(operations).toBe(300);
    expect(window.__FILMOVY_KVIZ_MEDIA_DEBUG__).toEqual({
      activePlayers: 0, peakPlayers: 1, createdPlayers: 200, destroyedPlayers: 200,
    });
    await act(async () => { view.root.unmount(); });
  });

  test('a failed API load can be retried by a new explicit generation', async () => {
    Reflect.deleteProperty(window, 'YT');
    const append = vi.spyOn(document.head, 'append').mockImplementation((...nodes: (Node | string)[]) => {
      for (const node of nodes) {
        if (node instanceof HTMLScriptElement) queueMicrotask(() => { node.onerror?.(new Event('error')); });
      }
    });
    const view = await mounted(<YouTubePlayer source="abcdefghijk" command="play" generation={20} startSeconds={0} />);
    await act(async () => {
      view.root.render(<YouTubePlayer source="abcdefghijk" command="replay" generation={21} startSeconds={0} />);
    });
    const scriptAttempts = append.mock.calls.flat().filter((value) => (
      value instanceof HTMLScriptElement && value.dataset.filmovyKvizYoutubeApi === 'true'
    ));
    expect(scriptAttempts).toHaveLength(2);
    await act(async () => { view.root.unmount(); });
  });

  test('keeps YouTube DOM replacement behind a stable React-owned boundary', async () => {
    Object.assign(window, {
      YT: {
        Player: DomReplacingFakePlayer,
        PlayerState: { ENDED: 0, PLAYING: 1 },
      },
    });
    const view = await mounted(<YouTubePlayer source="abcdefghijk" command="play" generation={1} startSeconds={0} />);
    await act(async () => {
      view.root.render(<p>Bezpečně nahrazený slide</p>);
    });
    expect(view.host.textContent).toContain('Bezpečně nahrazený slide');
    expect(window.__FILMOVY_KVIZ_MEDIA_DEBUG__).toEqual({
      activePlayers: 0, peakPlayers: 1, createdPlayers: 1, destroyedPlayers: 1,
    });
    await act(async () => { view.root.unmount(); });
  });

  test('a network-style player error during PLAYING recovers only after explicit REPLAY', async () => {
    const failed = vi.fn();
    const view = await mounted(
      <YouTubePlayer source="abcdefghijk" command="play" generation={40} startSeconds={3} endSeconds={9} onError={failed} />,
    );
    const first = FakePlayer.instances[0]!;
    await act(async () => { first.events.onReady(); first.events.onStateChange({ data: 1 }); });
    await act(async () => { first.events.onError(); });
    expect(failed).toHaveBeenCalledTimes(1);
    expect(view.host.querySelector('[data-media-lifecycle]')?.getAttribute('data-media-lifecycle')).toBe('ERROR');

    await act(async () => {
      view.root.render(
        <YouTubePlayer source="abcdefghijk" command="replay" generation={41} startSeconds={3} endSeconds={9} onError={failed} />,
      );
    });
    const recovered = FakePlayer.instances.at(-1)!;
    await act(async () => { recovered.events.onReady(); recovered.events.onStateChange({ data: 1 }); });
    await act(async () => { first.events.onError(); });
    expect(failed).toHaveBeenCalledTimes(1);
    expect(view.host.querySelector('[data-media-lifecycle]')?.getAttribute('data-media-lifecycle')).toBe('PLAYING');
    await act(async () => { view.root.unmount(); });
  });

  test('popup and fullscreen failures are detected without breaking projector state', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    expect(openOrFocusProjector('http://localhost/projector/safe-session')).toBeNull();
    expect(projectorPopupBlockedMessage).toMatch(/zablokoval otevření projektoru/u);
    open.mockRestore();

    const element = { requestFullscreen: vi.fn().mockRejectedValue(new Error('blocked')) } as unknown as HTMLElement;
    await expect(requestProjectorFullscreen(element)).resolves.toBe(false);
    expect(projectorFullscreenFailureMessage).toMatch(/nepodařila spustit/u);
  });
});
