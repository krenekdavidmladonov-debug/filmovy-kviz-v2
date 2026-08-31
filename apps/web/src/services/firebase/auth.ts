import { connectAuthEmulator, getAuth, type Auth } from 'firebase/auth';

import { getFirebaseAppContext } from './app';

let authService: Auth | undefined;

export function getFirebaseAuth(): Auth {
  if (authService) {
    return authService;
  }

  const { app, config } = getFirebaseAppContext();
  const auth = getAuth(app);

  if (config.useEmulators) {
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  }

  authService = auth;
  return authService;
}
