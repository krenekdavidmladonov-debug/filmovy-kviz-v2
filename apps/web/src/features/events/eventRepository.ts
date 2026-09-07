import {
  collection,
  doc,
  getDocFromServer,
  getDocsFromServer,
  orderBy,
  query,
} from 'firebase/firestore';

import { getFirebaseFirestore } from '../../services/firebase/firestore';
import { mapEvent, mapPublicEvent, mapRegistration } from './eventMappers';
import type { EventRecord, PublicEventRecord, RegistrationRecord } from './types';

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

export async function getPublicEvent(eventId: string): Promise<PublicEventRecord | null> {
  const snapshot = await getDocFromServer(doc(getFirebaseFirestore(), 'publicEvents', eventId));
  return snapshot.exists() ? mapPublicEvent(snapshot.id, snapshot.data()) : null;
}

export async function listEventRegistrations(eventId: string): Promise<readonly RegistrationRecord[]> {
  const snapshot = await getDocsFromServer(query(
    collection(getFirebaseFirestore(), 'events', eventId, 'registrations'),
    orderBy('createdAt', 'desc'),
  ));
  return snapshot.docs.map((item) => mapRegistration(item.id, item.data()));
}
