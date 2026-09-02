import { describe, expect, test } from 'vitest';

import { LiveSessionError } from '../functions/src/live/errors';
import { buildPublicSessionState, displayAnswer } from '../functions/src/live/publication';
import { applyLiveSessionAction, applyMediaPlaybackReport } from '../functions/src/live/session-machine';
import type { PrivateLiveSession, PrivateSlide } from '../functions/src/live/types';

const now = new Date('2026-09-01T10:00:00.000Z');

function session(overrides: Partial<PrivateLiveSession> = {}): PrivateLiveSession {
  return {
    sessionId: 'safe-session',
    quizId: 'safe-quiz',
    quizTitle: 'Syntetický kvíz',
    slideCount: 3,
    status: 'active',
    currentSlidePosition: 1,
    currentSlideId: 'slide-001',
    answerRevealed: false,
    presentationMode: 'slide',
    mediaCommand: 'idle',
    mediaPlaybackState: 'idle',
    mediaGeneration: 0,
    introGeneration: 0,
    revision: 1,
    createdBy: 'staff-1',
    updatedBy: 'staff-1',
    createdAt: now,
    startedAt: now,
    endedAt: null,
    updatedAt: now,
    ...overrides,
  };
}

function questionSlide(position = 1): PrivateSlide {
  return {
    id: `slide-${String(position).padStart(3, '0')}`,
    position,
    kind: 'question',
    isQuestion: true,
    title: 'Syntetická otázka',
    text: 'Veřejně zobrazitelný prompt',
    options: ['A', 'B', 'C'],
    media: [
      { role: 'prompt', kind: 'image', value: 'https://example.test/prompt.jpg' },
      { role: 'answer', kind: 'image', value: 'https://example.test/answer.jpg' },
      { role: 'unknown', kind: 'unknown', value: 'private-media' },
    ],
    presentation: { backgroundOverlay: 60, videoStart: 4, recapOverrides: [{ private: true }] },
    correctAnswer: 'SENTINEL-REVEALED-ANSWER',
    moderatorNote: 'SENTINEL-MODERATOR-NOTE',
    legacy: { raw: { correct: 'SENTINEL-LEGACY-ANSWER', privateField: 'SENTINEL-PRIVATE' } },
  };
}

function allKeys(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(allKeys);
  if (value === null || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, nested]) => [key, ...allKeys(nested)]);
}

function expectNoPrivateFields(value: unknown): void {
  expect(allKeys(value)).not.toEqual(expect.arrayContaining([
    'correctAnswer',
    'correct',
    'moderatorNote',
    'legacy',
    'raw',
    'privateField',
    'recapOverrides',
  ]));
}

describe('live-session publication security', () => {
  test('publishes an explicit allowlist before reveal without answer or private nested fields', () => {
    const publicState = buildPublicSessionState(session(), questionSlide());
    expect(publicState).toMatchObject({
      status: 'active',
      slidePosition: 1,
      answerRevealed: false,
      title: 'Syntetická otázka',
      options: ['A', 'B', 'C'],
      presentation: { backgroundOverlay: 60 },
      clipStartSeconds: 4,
    });
    expect(publicState).not.toHaveProperty('revealedAnswer');
    expect(publicState).not.toHaveProperty('answerImage');
    expect(publicState.media).toEqual([
      { role: 'prompt', kind: 'image', source: 'https://example.test/prompt.jpg' },
    ]);
    expect(JSON.stringify(publicState)).not.toContain('SENTINEL-');
    expectNoPrivateFields(publicState);
  });

  test('after reveal publishes only display answer and explicitly allowed answer image', () => {
    const publicState = buildPublicSessionState(session({ answerRevealed: true }), questionSlide());
    expect(publicState).toMatchObject({
      answerRevealed: true,
      revealedAnswer: 'SENTINEL-REVEALED-ANSWER',
      answerImage: 'https://example.test/answer.jpg',
    });
    expect(JSON.stringify(publicState)).not.toContain('SENTINEL-MODERATOR-NOTE');
    expect(JSON.stringify(publicState)).not.toContain('SENTINEL-LEGACY-ANSWER');
    expect(JSON.stringify(publicState)).not.toContain('SENTINEL-PRIVATE');
    expectNoPrivateFields(publicState);
  });

  test('rejects blank and non-finite display answers consistently', () => {
    for (const value of ['', '   ', [], [Number.NaN], [Number.POSITIVE_INFINITY]]) {
      expect(displayAnswer(value)).toBeUndefined();
    }
    expect(displayAnswer([0, false, 'A'])).toBe('0, false, A');
  });

  test('moving after reveal resets the answer and removes stale answer fields', () => {
    const revealed = session({ answerRevealed: true, revision: 5 });
    const nextSlide = questionSlide(2);
    const moved = applyLiveSessionAction(
      revealed,
      { type: 'next-slide', slideId: nextSlide.id },
      5,
      'staff-2',
      now,
      nextSlide,
    );
    const publicState = buildPublicSessionState(moved, nextSlide);
    expect(moved).toMatchObject({ currentSlidePosition: 2, answerRevealed: false, revision: 6 });
    expect(publicState.answerRevealed).toBe(false);
    expect(publicState).not.toHaveProperty('revealedAnswer');
    expect(publicState).not.toHaveProperty('answerImage');
    expectNoPrivateFields(publicState);
  });

  test('waiting and ended snapshots contain no stale slide payload', () => {
    const waiting = buildPublicSessionState(session({
      status: 'waiting',
      currentSlidePosition: 0,
      currentSlideId: undefined,
    }), questionSlide());
    const ended = buildPublicSessionState(session({ status: 'ended', answerRevealed: true }), questionSlide());
    for (const state of [waiting, ended]) {
      expect(state.answerRevealed).toBe(false);
      expect(state).not.toHaveProperty('title');
      expect(state).not.toHaveProperty('revealedAnswer');
      expectNoPrivateFields(state);
    }
  });

  test('legacy pl is rendered through safe public fallback without raw metadata', () => {
    const legacy = { ...questionSlide(), kind: 'pl', legacy: { raw: { correct: 'private' } } };
    const publicState = buildPublicSessionState(session(), legacy);
    expect(publicState.slideKind).toBe('pl');
    expectNoPrivateFields(publicState);
  });

  test('normal audio never publishes its source while recap publishes only the selected answer and media', () => {
    const audio: PrivateSlide = {
      ...questionSlide(2), id: 'slide-002', kind: 'audio', mediaSource: 'abcdefghijk',
      questionNumber: 2, questionCount: 10,
    };
    const normal = buildPublicSessionState(session({ currentSlidePosition: 2, currentSlideId: 'slide-002' }), audio);
    expect(normal).not.toHaveProperty('mediaSource');
    expect(normal).not.toHaveProperty('revealedAnswer');
    expectNoPrivateFields(normal);

    const recapState = buildPublicSessionState(session({
      currentSlidePosition: 3,
      currentSlideId: 'slide-003',
      presentationMode: 'recap',
      recapQuestionPosition: 2,
      recapQuestionId: 'slide-002',
      answerRevealed: true,
    }), audio);
    expect(recapState).toMatchObject({ renderMode: 'recap', mediaSource: 'abcdefghijk', revealedAnswer: 'SENTINEL-REVEALED-ANSWER' });
    expectNoPrivateFields(recapState);
  });
});

describe('live-session state machine', () => {
  test('500 alternating slide transitions remain bounded and never retain an answer', () => {
    let current = session({ slideCount: 2, answerRevealed: true });
    const durations: number[] = [];
    for (let index = 0; index < 500; index += 1) {
      const target = current.currentSlidePosition === 1 ? questionSlide(2) : questionSlide(1);
      const action = current.currentSlidePosition === 1
        ? { type: 'next-slide' as const, slideId: target.id }
        : { type: 'previous-slide' as const, slideId: target.id };
      const started = performance.now();
      current = applyLiveSessionAction(current, action, current.revision, 'moderator', now, target);
      durations.push(performance.now() - started);
      const publicState = buildPublicSessionState(current, target);
      expect(publicState.answerRevealed).toBe(false);
      expect(publicState).not.toHaveProperty('revealedAnswer');
      expectNoPrivateFields(publicState);
    }
    const mean = (values: readonly number[]) => values.reduce((total, value) => total + value, 0) / values.length;
    expect(current.revision).toBe(501);
    expect(mean(durations.slice(250))).toBeLessThan(mean(durations.slice(0, 250)) * 10 + 0.1);
  });

  test('starts at position zero, then moves next and previous with monotonic revisions', () => {
    const waiting = session({
      status: 'waiting',
      currentSlidePosition: 0,
      currentSlideId: undefined,
      revision: 0,
      startedAt: null,
    });
    const first = questionSlide(1);
    const active = applyLiveSessionAction(
      waiting,
      { type: 'next-slide', slideId: first.id },
      0,
      'moderator',
      now,
      first,
    );
    expect(active).toMatchObject({ status: 'active', currentSlidePosition: 1, revision: 1 });

    const second = questionSlide(2);
    const advanced = applyLiveSessionAction(active, { type: 'next-slide', slideId: second.id }, 1, 'moderator', now, second);
    const returned = applyLiveSessionAction(advanced, { type: 'previous-slide', slideId: first.id }, 2, 'moderator', now, first);
    expect(returned).toMatchObject({ currentSlidePosition: 1, revision: 3 });
  });

  test('reveals and hides an answer only on an active question', () => {
    const slide = questionSlide();
    const revealed = applyLiveSessionAction(session(), { type: 'reveal-answer' }, 1, 'moderator', now, slide);
    expect(revealed).toMatchObject({ answerRevealed: true, revision: 2 });
    const hidden = applyLiveSessionAction(revealed, { type: 'hide-answer' }, 2, 'moderator', now, slide);
    expect(hidden).toMatchObject({ answerRevealed: false, revision: 3 });
  });

  test('rejects invalid positions, ended mutations, missing answers, and stale concurrent operations', () => {
    const first = questionSlide();
    expect(() => applyLiveSessionAction(
      session(),
      { type: 'go-to-slide', position: 99, slideId: first.id },
      1,
      'moderator',
      now,
      first,
    )).toThrow(LiveSessionError);
    expect(() => applyLiveSessionAction(session({ status: 'ended' }), { type: 'reveal-answer' }, 1, 'moderator', now, first))
      .toThrow(/ended/u);
    expect(() => applyLiveSessionAction(session(), { type: 'reveal-answer' }, 1, 'moderator', now, {
      ...first,
      correctAnswer: undefined,
    })).toThrow(/displayable answer/u);
    expect(() => applyLiveSessionAction(session({ revision: 8 }), { type: 'reveal-answer' }, 7, 'moderator', now, first))
      .toThrow(/changed/u);
  });

  test('ending clears reveal state and prevents all later mutations', () => {
    const ended = applyLiveSessionAction(
      session({ answerRevealed: true }),
      { type: 'end-session' },
      1,
      'admin',
      now,
    );
    expect(ended).toMatchObject({ status: 'ended', answerRevealed: false, revision: 2, endedAt: now });
    expect(() => applyLiveSessionAction(ended, { type: 'hide-answer' }, 2, 'admin', now, questionSlide()))
      .toThrow(/ended/u);
  });

  test('selects recap questions in arbitrary order and resets media generation on every selection', () => {
    const recapSession = session({
      currentSlidePosition: 3,
      currentSlideId: 'slide-003',
      presentationMode: 'recap',
      mediaGeneration: 4,
    });
    const second = questionSlide(2);
    const selectedSecond = applyLiveSessionAction(
      recapSession,
      { type: 'select-recap-question', position: 2, slideId: second.id },
      1,
      'moderator',
      now,
      second,
    );
    expect(selectedSecond).toMatchObject({ recapQuestionPosition: 2, answerRevealed: true, mediaGeneration: 5 });
    const first = questionSlide(1);
    const selectedFirst = applyLiveSessionAction(
      selectedSecond,
      { type: 'select-recap-question', position: 1, slideId: first.id },
      2,
      'moderator',
      now,
      first,
    );
    expect(selectedFirst).toMatchObject({ recapQuestionPosition: 1, answerRevealed: true, revision: 3, mediaGeneration: 6 });
  });

  test('media commands carry monotonic generations and stale slide callbacks cannot target a replaced slide', () => {
    const audio = { ...questionSlide(), kind: 'audio' };
    const playing = applyLiveSessionAction(session(), { type: 'play-media' }, 1, 'moderator', now, audio);
    expect(playing).toMatchObject({ mediaCommand: 'play', mediaPlaybackState: 'preparing', mediaGeneration: 1, revision: 2 });
    expect(() => applyLiveSessionAction(playing, { type: 'finish-media' }, 2, 'moderator', now, questionSlide(2)))
      .toThrow(/active presentation slide/u);
    const stopped = applyLiveSessionAction(playing, { type: 'stop-media' }, 2, 'moderator', now, audio);
    expect(stopped).toMatchObject({ mediaCommand: 'stop', mediaPlaybackState: 'idle', mediaGeneration: 2, revision: 3 });
  });

  test('trusted playback reports distinguish command from actual player state and reject stale order', () => {
    const audio = { ...questionSlide(), kind: 'audio' };
    const preparing = applyLiveSessionAction(session(), { type: 'play-media' }, 1, 'moderator', now, audio);
    const ready = applyMediaPlaybackReport(preparing, 'ready', preparing.mediaGeneration, 'moderator', now);
    expect(ready).toMatchObject({ mediaCommand: 'play', mediaPlaybackState: 'ready', revision: 3 });
    const playing = applyMediaPlaybackReport(ready, 'playing', ready.mediaGeneration, 'moderator', now);
    expect(playing).toMatchObject({ mediaCommand: 'play', mediaPlaybackState: 'playing', revision: 4 });
    const failed = applyMediaPlaybackReport(playing, 'error', playing.mediaGeneration, 'moderator', now);
    expect(failed).toMatchObject({ mediaCommand: 'error', mediaPlaybackState: 'error', revision: 5 });
    expect(() => applyMediaPlaybackReport(failed, 'ready', failed.mediaGeneration, 'moderator', now)).toThrow(/out-of-order/u);
    expect(() => applyMediaPlaybackReport(playing, 'finished', playing.mediaGeneration - 1, 'moderator', now)).toThrow(/stale/u);
  });
});
