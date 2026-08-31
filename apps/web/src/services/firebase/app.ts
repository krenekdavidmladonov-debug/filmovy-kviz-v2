import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';

import { readFirebaseConfig, type FirebaseRuntimeConfig } from './config';

interface FirebaseAppContext {
  readonly app: FirebaseApp;
  readonly config: FirebaseRuntimeConfig;
}

let appContext: FirebaseAppContext | undefined;

export function getFirebaseAppContext(): FirebaseAppContext {
  if (appContext) {
    return appContext;
  }

  const config = readFirebaseConfig();
  const app = getApps().length === 0 ? initializeApp(config.options) : getApp();
  appContext = { app, config };
  return appContext;
}
