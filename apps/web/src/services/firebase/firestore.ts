import { connectFirestoreEmulator, getFirestore, type Firestore } from 'firebase/firestore';

import { getFirebaseAppContext } from './app';
import { getFirebaseEmulatorEndpoints } from './emulators';

let firestoreService: Firestore | undefined;

export function getFirebaseFirestore(): Firestore {
  if (firestoreService) {
    return firestoreService;
  }

  const { app, config } = getFirebaseAppContext();
  const db = getFirestore(app);

  if (config.useEmulators) {
    const endpoint = getFirebaseEmulatorEndpoints();
    connectFirestoreEmulator(db, endpoint.host, endpoint.firestorePort);
  }

  firestoreService = db;
  return firestoreService;
}
