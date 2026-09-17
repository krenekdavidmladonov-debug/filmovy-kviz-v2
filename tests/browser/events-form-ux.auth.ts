import { hasPermission, type Membership } from '../../packages/quiz-domain/src/access';
import type { useAuth as useApplicationAuth } from '../../apps/web/src/auth/AuthProvider';

type AuthValue = ReturnType<typeof useApplicationAuth>;

// This preview never authenticates, issues tokens or changes a real account.
const unsupportedAuthOperation = (): Promise<never> => Promise.reject(new Error('Authentication operations are unavailable in the isolated event-form fixture.'));

export function createEventFormAuth(profile: string | null): AuthValue {
  const role = profile === null || profile === 'admin' ? 'admin' : profile === 'moderator' ? 'moderator' : null;
  const membership: Membership | null = role === null ? null : {
    uid: `event-form-${role}`, email: 'staff@example.test', displayName: 'Syntetický pracovník',
    status: 'active', version: 1, sessionValidAfter: 0,
    role: role === 'admin' ? 'manager' : 'moderator',
    // Only the actions represented by these form scenarios are granted.
    permissions: role === 'admin' ? ['event.read', 'event.create', 'event.manage'] : ['event.read'],
    quizzes: { mode: 'none', ids: [] }, events: { mode: 'selected', ids: ['synthetic-event'] },
  };
  const currentUser: AuthValue['currentUser'] = membership === null ? null : {
    uid: membership.uid, email: membership.email, displayName: membership.displayName,
    emailVerified: true, isAnonymous: false, phoneNumber: null, photoURL: null,
    providerId: 'firebase', providerData: [], tenantId: null, refreshToken: '', metadata: {},
    delete: unsupportedAuthOperation, reload: unsupportedAuthOperation,
    getIdToken: unsupportedAuthOperation, getIdTokenResult: unsupportedAuthOperation,
    toJSON: () => ({ uid: membership.uid, email: membership.email }),
  };
  return {
    currentUser, role, membership, loading: false, initializationError: null,
    can: permission => membership?.status === 'active' && hasPermission(membership, permission) || false,
    signIn: unsupportedAuthOperation, signOut: unsupportedAuthOperation,
  };
}
