import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { permissions, type Membership, type Permission } from '@filmovy-kviz/quiz-domain';

const localHost = /^(localhost|127\.0\.0\.1|\[::1\]):([1-9]\d{0,4})$/u;
/** Test compatibility only: never imported into the deployed Functions entry point. */
export async function seedEmulatorMembership(uid: string, role: string): Promise<void> {
  const projectId = process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT;
  if (!projectId?.startsWith('demo-') || !localHost.test(process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '') || !localHost.test(process.env.FIRESTORE_EMULATOR_HOST ?? '')) {
    throw new Error('Membership fixtures require a demo project and local Auth AND Firestore emulators.');
  }
  const app = initializeApp({ projectId }, 'membership-fixture-' + uid);
  try {
    const auth = getAuth(app), db = getFirestore(app), user = await auth.getUser(uid), ref = db.doc(`memberships/${uid}`);
    const old = (await ref.get()).data() as Membership | undefined;
    if (role !== 'admin' && role !== 'moderator') {
      if (old) await ref.update({ status: 'suspended', version: old.version + 1 });
      return;
    }
    await auth.updateUser(uid, { emailVerified: true });
    const moderatorPermissions: Permission[] = ['quiz.read', 'quiz.answers.read', 'quiz.notes.read', 'event.read', 'event.live', 'event.score', 'event.contacts', 'event.answers.read', 'event.notes.read', 'event.export'];
    const member: Membership = { uid, role: role === 'admin' ? 'manager' : 'moderator', permissions: role === 'admin' ? [...permissions] : moderatorPermissions,
      quizzes: { mode: 'all', ids: [] }, events: { mode: 'all', ids: [] }, status: 'active', version: (old?.version ?? 0) + 1,
      sessionValidAfter: old?.sessionValidAfter ?? 0, displayName: user.displayName ?? '', email: user.email ?? '' };
    await ref.set(member);
  } finally { await deleteApp(app); }
}
