import { connectFirestoreEmulator, getFirestore, type Firestore } from 'firebase/firestore';

import { getFirebaseAppContext } from './app';

let firestoreService: Firestore | undefined;

export function getFirebaseFirestore(): Firestore {
  if (firestoreService) {
    return firestoreService;
  }

  const { app, config } = getFirebaseAppContext();
  const db = getFirestore(app);

  if (config.useEmulators) {
    connectFirestoreEmulator(db, '127.0.0.1', 8080);
  }

  firestoreService = db;
  return firestoreService;
}
