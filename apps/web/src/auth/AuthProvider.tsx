import {
  createContext,
  Fragment,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  getIdTokenResult,
  onIdTokenChanged,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  type User,
} from 'firebase/auth';

import { getFirebaseAuth } from '../services/firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { getFirebaseFirestore } from '../services/firebase/firestore';
import type { Membership, Permission } from '@filmovy-kviz/quiz-domain';
import { invalidatePrivateAccess } from '../features/access/api';
import { waitForSignInWindow } from './sessionRevocation';

export type StaffRole = 'admin' | 'moderator';

interface AuthContextValue {
  readonly currentUser: User | null;
  readonly role: StaffRole | null;
  readonly membership: Membership | null;
  readonly can: (permission: Permission) => boolean;
  readonly loading: boolean;
  readonly initializationError: string | null;
  readonly signIn: (email: string, password: string) => Promise<void>;
  readonly signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { readonly children: ReactNode }) {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [role, setRole] = useState<StaffRole | null>(null);
  const [member, setMember] = useState<Membership | null>(null);
  const [loading, setLoading] = useState(true);
  const [initializationError, setInitializationError] = useState<string | null>(null);
  const accessKey = useRef('');
  const identityKey = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    let generation = 0;
    let stopMembership: (() => void) | undefined;

    try {
      const auth = getFirebaseAuth();

      const unsubscribe = onIdTokenChanged(auth, (user) => {
        const attempt = ++generation;
        stopMembership?.();
        if (identityKey.current !== (user?.uid ?? null)) {
          invalidatePrivateAccess(); accessKey.current = ''; identityKey.current = user?.uid ?? null;
          setMember(null); setRole(null); setLoading(true);
        }
        setCurrentUser(user);
        void (async () => {
          try {
            const tokenResult = user ? await getIdTokenResult(user) : null;

            if (!active || attempt !== generation) {
              return;
            }

            setCurrentUser(user);
            setInitializationError(null);
            if (!user || !tokenResult?.claims.email_verified) {
              invalidatePrivateAccess(); accessKey.current = ''; setMember(null); setRole(null); setLoading(false); return;
            }
            stopMembership = onSnapshot(doc(getFirebaseFirestore(), 'memberships', user.uid), { includeMetadataChanges: true }, snapshot => {
              if (!active || attempt !== generation || snapshot.metadata.fromCache) return;
              const next = snapshot.exists() ? snapshot.data() as Membership : null;
              const valid = next?.status === 'active' && Number(tokenResult.claims.auth_time) > next.sessionValidAfter ? next : null;
              const key = `${user.uid}:${valid?.version ?? 0}:${valid?.status ?? 'none'}`;
              if (key !== accessKey.current) { invalidatePrivateAccess(); accessKey.current = key; }
              setMember(valid);
              setRole(valid ? (valid.permissions.includes('quiz.edit') || valid.permissions.includes('event.manage') ? 'admin' : 'moderator') : null);
              setLoading(false);
            }, () => {
              if (!active || attempt !== generation) return;
              invalidatePrivateAccess(); setMember(null); setRole(null); setLoading(false);
            });
          } catch {
            if (active && attempt === generation) {
              invalidatePrivateAccess();
              setCurrentUser(null);
              setMember(null);
              setRole(null);
              setInitializationError('Nepodařilo se ověřit přihlašovací údaje. Zkuste to znovu.');
            }
            if (active && attempt === generation) setLoading(false);
          }
        })();
      });

      return () => {
        active = false;
        generation++; stopMembership?.(); invalidatePrivateAccess();
        unsubscribe();
      };
    } catch {
      setInitializationError(
        'Přihlášení teď není dostupné. Zkuste aplikaci načíst znovu.',
      );
      setLoading(false);
      return () => {
        active = false;
      };
    }
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    currentUser,
    role,
    membership: member,
    can: permission => member?.status === 'active' && member.permissions.includes(permission) || false,
    loading,
    initializationError,
    async signIn(email: string, password: string) {
      await waitForSignInWindow();
      const auth = getFirebaseAuth();
      const credential = await signInWithEmailAndPassword(auth, email.trim(), password);
      await getIdTokenResult(credential.user, true);
    },
    async signOut() {
      const auth = getFirebaseAuth();
      invalidatePrivateAccess(); setMember(null);
      await firebaseSignOut(auth);
      setCurrentUser(null);
      setRole(null);
    },
  }), [currentUser, initializationError, loading, role, member]);

  return <AuthContext.Provider value={value}><Fragment key={`${currentUser?.uid ?? 'anonymous'}:${member?.version ?? 0}`}>{children}</Fragment></AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error('useAuth must be used inside AuthProvider.');
  }

  return context;
}
