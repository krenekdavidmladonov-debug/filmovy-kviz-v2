import { afterEach, describe, expect, test, vi } from 'vitest';

const firestoreMocks = vi.hoisted(() => ({
  doc: vi.fn(() => ({ path: 'publicSessions/safe-session' })),
  onSnapshot: vi.fn(),
}));

vi.mock('firebase/firestore', () => firestoreMocks);
vi.mock('../apps/web/src/services/firebase/firestore', () => ({
  getFirebaseFirestore: () => ({ kind: 'mock-firestore' }),
}));

import { subscribeLiveControl, subscribePublicLiveState } from '../apps/web/src/features/live/liveRepository';

describe('public projector subscription safety', () => {
  afterEach(() => vi.clearAllMocks());

  test('rejects cache-only state, then accepts a server-confirmed snapshot', () => {
    let emit: ((snapshot: unknown) => void) | undefined;
    const unsubscribe = vi.fn();
    firestoreMocks.onSnapshot.mockImplementation((...args: unknown[]) => {
      emit = args[2] as (snapshot: unknown) => void;
      return unsubscribe;
    });
    const onValue = vi.fn();
    const onError = vi.fn();

    const returned = subscribePublicLiveState('safe-session', onValue, onError);
    const data = {
      quizTitle: 'Syntetický kvíz',
      status: 'active',
      slidePosition: 1,
      answerRevealed: true,
      revealedAnswer: 'SENTINEL-REVEALED-ANSWER',
      revision: 2,
    };

    emit?.({ id: 'safe-session', metadata: { fromCache: true }, exists: () => true, data: () => data });
    expect(onError).toHaveBeenCalledOnce();
    expect(onValue).not.toHaveBeenCalled();

    emit?.({ id: 'safe-session', metadata: { fromCache: false }, exists: () => true, data: () => data });
    expect(onValue).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'safe-session',
      revealedAnswer: 'SENTINEL-REVEALED-ANSWER',
    }));
    expect(returned).toBe(unsubscribe);
  });
});

test('private live subscription never forwards another identity cache before server authorization', () => {
  let emit: ((snapshot: unknown) => void) | undefined;
  firestoreMocks.onSnapshot.mockImplementation((...args: unknown[]) => {
    emit = args[2] as (snapshot: unknown) => void;
    return vi.fn();
  });
  const onValue = vi.fn(), onError = vi.fn();
  subscribeLiveControl('private-session-a', onValue, onError);
  const readCachedData = vi.fn(() => ({ quizTitle: 'PRIVATE_SESSION_A' }));
  emit?.({ id: 'private-session-a', metadata: { fromCache: true }, exists: () => true, data: readCachedData });
  expect(readCachedData).not.toHaveBeenCalled();
  expect(onValue).not.toHaveBeenCalled();
  emit?.({ id: 'private-session-a', metadata: { fromCache: false }, exists: () => false });
  expect(onValue).toHaveBeenCalledWith(null);
});
