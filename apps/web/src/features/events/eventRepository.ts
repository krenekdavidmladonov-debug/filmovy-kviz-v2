import {
  collection,
  doc,
  getDocFromServer,
  getDocsFromServer,
  orderBy,
  query,
} from 'firebase/firestore';

import { getFirebaseFirestore } from '../../services/firebase/firestore';
import { privateRead, type PrivateDocument } from '../access/api';
import { mapEvent, mapPublicEvent, mapRegistration } from './eventMappers';
import type { EventRecord, PublicEventRecord, RegistrationRecord } from './types';

export async function listEvents(): Promise<readonly EventRecord[]> {
  const result = await privateRead<PrivateDocument[]>('events');
  return result.map(item => mapEvent(item.id, item.data)).sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime());
}

export async function getEvent(eventId: string): Promise<EventRecord | null> {
  const result = await privateRead<PrivateDocument>('event', { eventId });
  return mapEvent(result.id, result.data);
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
  const result = await privateRead<PrivateDocument[]>('registrations', { eventId });
  return result.map(item => mapRegistration(item.id, item.data)).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}
