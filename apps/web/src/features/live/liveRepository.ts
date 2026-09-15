import { doc, getDocFromServer, onSnapshot, type Unsubscribe } from 'firebase/firestore';
import { watchPrivate } from '../access/api';
import type { EditorSlide } from '@filmovy-kviz/quiz-domain';

import { getFirebaseFirestore } from '../../services/firebase/firestore';
import { mapLiveControlSlide, mapLiveControlState, mapPublicLiveState } from './liveMappers';
import type { LiveControlSlide, LiveControlState, PublicLiveState } from './types';

type ValueHandler<T> = (value: T | null) => void;
type ErrorHandler = (error: Error) => void;

export function subscribeLiveControl(sessionId: string, onValue: ValueHandler<LiveControlState>, onError: ErrorHandler): Unsubscribe {
  return onSnapshot(doc(getFirebaseFirestore(), 'sessions', sessionId), { includeMetadataChanges: true }, (snapshot) => {
    if (snapshot.metadata.fromCache) return;
    onValue(snapshot.exists() ? mapLiveControlState(snapshot.id, snapshot.data()) : null);
  }, onError);
}

export function subscribeLiveControlSlide(
  quizId: string,
  slideId: string,
  onValue: ValueHandler<LiveControlSlide>,
  onError: ErrorHandler,
): Unsubscribe {
  return watchPrivate<EditorSlide[]>('quizSlides', { quizId }, slides => {
    const slide = slides.find(item => item.id === slideId);
    onValue(slide ? mapLiveControlSlide(slide.id, { ...slide }) : null);
  }, onError);
}

export function subscribeLiveControlSlides(
  quizId: string,
  onValue: (value: readonly LiveControlSlide[]) => void,
  onError: ErrorHandler,
  snapshotId?: string,
): Unsubscribe {
  return watchPrivate<EditorSlide[]>(snapshotId ? 'snapshotSlides' : 'quizSlides', snapshotId ? { snapshotId } : { quizId }, slides => onValue(slides.map(item => mapLiveControlSlide(item.id, { ...item }))), onError);
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

export async function readPublicLiveStateFromServer(sessionId: string): Promise<PublicLiveState | null> {
  const snapshot = await getDocFromServer(doc(getFirebaseFirestore(), 'publicSessions', sessionId));
  return snapshot.exists() ? mapPublicLiveState(snapshot.id, snapshot.data()) : null;
}
