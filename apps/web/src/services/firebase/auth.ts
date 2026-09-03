import { connectAuthEmulator, getAuth, type Auth } from 'firebase/auth';

import { getFirebaseAppContext } from './app';
import { getFirebaseEmulatorEndpoints } from './emulators';

let authService: Auth | undefined;

export function getFirebaseAuth(): Auth {
  if (authService) {
    return authService;
  }

  const { app, config } = getFirebaseAppContext();
  const auth = getAuth(app);

  if (config.useEmulators) {
    const endpoint = getFirebaseEmulatorEndpoints();
    connectAuthEmulator(auth, `http://${endpoint.host}:${endpoint.authPort}`, { disableWarnings: true });
  }

  authService = auth;
  return authService;
}
