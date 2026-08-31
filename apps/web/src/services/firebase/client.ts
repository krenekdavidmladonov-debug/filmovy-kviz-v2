import { getApp, getApps, initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, type Auth } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore, type Firestore } from 'firebase/firestore';
import { connectFunctionsEmulator, getFunctions, type Functions } from 'firebase/functions';
import { connectStorageEmulator, getStorage, type FirebaseStorage } from 'firebase/storage';

import { readFirebaseConfig } from './config';

export interface FirebaseServices {
  readonly auth: Auth;
  readonly db: Firestore;
  readonly functions: Functions;
  readonly storage: FirebaseStorage;
}

let services: FirebaseServices | undefined;

export function getFirebaseServices(): FirebaseServices {
  if (services) {
    return services;
  }

  const config = readFirebaseConfig();
  const app = getApps().length === 0 ? initializeApp(config.options) : getApp();
  const auth = getAuth(app);
  const db = getFirestore(app);
  const functions = getFunctions(app, 'europe-west1');
  const storage = getStorage(app);

  if (config.useEmulators) {
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    connectFirestoreEmulator(db, '127.0.0.1', 8080);
    connectFunctionsEmulator(functions, '127.0.0.1', 5001);
    connectStorageEmulator(storage, '127.0.0.1', 9199);
  }

  services = { auth, db, functions, storage };
  return services;
}
