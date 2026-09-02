import {
  collection,
  doc,
  getDocFromServer,
  getDocsFromServer,
  orderBy,
  query,
} from 'firebase/firestore';

import { getFirebaseFirestore } from '../../services/firebase/firestore';
import { mapEvent, mapPublicEvent } from './eventMappers';
import type { EventRecord, PublicEventRecord } from './types';

export async function listEvents(): Promise<readonly EventRecord[]> {
  const snapshot = await getDocsFromServer(query(
    collection(getFirebaseFirestore(), 'events'),
    orderBy('startsAt', 'desc'),
  ));
  return snapshot.docs.map((item) => mapEvent(item.id, item.data()));
}

export async function getEvent(eventId: string): Promise<EventRecord | null> {
  const snapshot = await getDocFromServer(doc(getFirebaseFirestore(), 'events', eventId));
  return snapshot.exists() ? mapEvent(snapshot.id, snapshot.data()) : null;
}

export async function listPublicEvents(): Promise<readonly PublicEventRecord[]> {
  const snapshot = await getDocsFromServer(query(
    collection(getFirebaseFirestore(), 'publicEvents'),
    orderBy('startsAt', 'asc'),
  ));
  return snapshot.docs.map((item) => mapPublicEvent(item.id, item.data()));
}
