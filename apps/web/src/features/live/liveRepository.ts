import { doc, onSnapshot, type Unsubscribe } from 'firebase/firestore';

import { getFirebaseFirestore } from '../../services/firebase/firestore';
import { mapLiveControlSlide, mapLiveControlState, mapPublicLiveState } from './liveMappers';
import type { LiveControlSlide, LiveControlState, PublicLiveState } from './types';

type ValueHandler<T> = (value: T | null) => void;
type ErrorHandler = (error: Error) => void;

export function subscribeLiveControl(
  sessionId: string,
  onValue: ValueHandler<LiveControlState>,
  onError: ErrorHandler,
): Unsubscribe {
  return onSnapshot(doc(getFirebaseFirestore(), 'sessions', sessionId), (snapshot) => {
    onValue(snapshot.exists() ? mapLiveControlState(snapshot.id, snapshot.data()) : null);
  }, onError);
}

export function subscribeLiveControlSlide(
  quizId: string,
  slideId: string,
  onValue: ValueHandler<LiveControlSlide>,
  onError: ErrorHandler,
): Unsubscribe {
  return onSnapshot(doc(getFirebaseFirestore(), 'quizzes', quizId, 'slides', slideId), (snapshot) => {
    onValue(snapshot.exists() ? mapLiveControlSlide(snapshot.id, snapshot.data()) : null);
  }, onError);
}

export function subscribePublicLiveState(
  sessionId: string,
  onValue: ValueHandler<PublicLiveState>,
  onError: ErrorHandler,
): Unsubscribe {
  return onSnapshot(
    doc(getFirebaseFirestore(), 'publicSessions', sessionId),
    { includeMetadataChanges: true },
    (snapshot) => {
      if (snapshot.metadata.fromCache) {
        onError(new Error('Refusing cached projector state.'));
        return;
      }
      onValue(snapshot.exists() ? mapPublicLiveState(snapshot.id, snapshot.data()) : null);
    },
    onError,
  );
}
