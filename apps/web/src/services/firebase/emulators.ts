export interface FirebaseEmulatorEndpoints {
  readonly host: '127.0.0.1';
  readonly authPort: number;
  readonly firestorePort: number;
  readonly functionsPort: number;
  readonly storagePort: number;
}

export function parseFirebaseEmulatorPort(raw: string | undefined, name: string, fallback: number): number {
  if (raw === undefined || raw === '') return fallback;
  if (!/^\d{1,5}$/u.test(raw)) throw new Error(`${name} must be a numeric localhost port.`);
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`${name} must be between 1 and 65535.`);
  }
  return port;
}

function emulatorPort(name: keyof ImportMetaEnv, fallback: number): number {
  const configured: unknown = import.meta.env[name];
  return parseFirebaseEmulatorPort(typeof configured === 'string' ? configured : undefined, String(name), fallback);
}

export function getFirebaseEmulatorEndpoints(): FirebaseEmulatorEndpoints {
  return {
    host: '127.0.0.1',
    authPort: emulatorPort('VITE_FIREBASE_AUTH_EMULATOR_PORT', 9099),
    firestorePort: emulatorPort('VITE_FIRESTORE_EMULATOR_PORT', 8080),
    functionsPort: emulatorPort('VITE_FUNCTIONS_EMULATOR_PORT', 5001),
    storagePort: emulatorPort('VITE_FIREBASE_STORAGE_EMULATOR_PORT', 9199),
  };
}
