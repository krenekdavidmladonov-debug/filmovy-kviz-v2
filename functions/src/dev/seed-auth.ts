import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getAuth, type UserRecord } from 'firebase-admin/auth';

const testPassword = 'LocalQuiz123!';
const testUsers = [
  { email: 'admin@example.test', displayName: 'Local Admin', claims: { role: 'admin' } },
  { email: 'moderator@example.test', displayName: 'Local Moderator', claims: { role: 'moderator' } },
  { email: 'user@example.test', displayName: 'Local User', claims: {} },
] as const;

function assertSafeEmulatorEnvironment(): string {
  const emulatorHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  const projectId = process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT;

  if (emulatorHost !== '127.0.0.1:9099' && emulatorHost !== 'localhost:9099') {
    throw new Error('Refusing to seed: FIREBASE_AUTH_EMULATOR_HOST must point to local port 9099.');
  }

  if (!projectId?.startsWith('demo-')) {
    throw new Error('Refusing to seed: the Firebase project ID must start with demo-.');
  }

  return projectId;
}

function isUserNotFound(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && error.code === 'auth/user-not-found';
}

async function ensureUser(email: string, displayName: string): Promise<UserRecord> {
  const auth = getAuth();

  try {
    const existingUser = await auth.getUserByEmail(email);
    return await auth.updateUser(existingUser.uid, { displayName, password: testPassword });
  } catch (error) {
    if (!isUserNotFound(error)) {
      throw error;
    }

    return auth.createUser({ email, displayName, password: testPassword, emailVerified: true });
  }
}

async function seed(): Promise<void> {
  const projectId = assertSafeEmulatorEnvironment();
  const app = initializeApp({ projectId });

  try {
    for (const testUser of testUsers) {
      const user = await ensureUser(testUser.email, testUser.displayName);
      await getAuth().setCustomUserClaims(user.uid, testUser.claims);
      console.log(`Seeded emulator-only user: ${testUser.email}`);
    }

    console.log(`Development-only password for all seeded users: ${testPassword}`);
  } finally {
    await deleteApp(app);
  }
}

void seed().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
