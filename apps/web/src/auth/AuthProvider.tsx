import {
  createContext,
  useContext,
  useEffect,
  useMemo,
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

export type StaffRole = 'admin' | 'moderator';

interface AuthContextValue {
  readonly currentUser: User | null;
  readonly role: StaffRole | null;
  readonly loading: boolean;
  readonly initializationError: string | null;
  readonly signIn: (email: string, password: string) => Promise<void>;
  readonly signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function readStaffRole(claims: Record<string, unknown>): StaffRole | null {
  return claims.role === 'admin' || claims.role === 'moderator' ? claims.role : null;
}

export function AuthProvider({ children }: { readonly children: ReactNode }) {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [role, setRole] = useState<StaffRole | null>(null);
  const [loading, setLoading] = useState(true);
  const [initializationError, setInitializationError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    try {
      const auth = getFirebaseAuth();

      const unsubscribe = onIdTokenChanged(auth, (user) => {
        void (async () => {
          try {
            const tokenResult = user ? await getIdTokenResult(user) : null;

            if (!active) {
              return;
            }

            setCurrentUser(user);
            setRole(tokenResult ? readStaffRole(tokenResult.claims) : null);
            setInitializationError(null);
          } catch {
            if (active) {
              setCurrentUser(null);
              setRole(null);
              setInitializationError('Nepodařilo se ověřit přihlašovací údaje. Zkuste to znovu.');
            }
          } finally {
            if (active) {
              setLoading(false);
            }
          }
        })();
      });

      return () => {
        active = false;
        unsubscribe();
      };
    } catch {
      setInitializationError(
        'Přihlášení není lokálně nakonfigurované. Zkontrolujte Firebase Emulator a soubor .env.local.',
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
    loading,
    initializationError,
    async signIn(email: string, password: string) {
      const auth = getFirebaseAuth();
      const credential = await signInWithEmailAndPassword(auth, email.trim(), password);
      const tokenResult = await getIdTokenResult(credential.user, true);
      setCurrentUser(credential.user);
      setRole(readStaffRole(tokenResult.claims));
    },
    async signOut() {
      const auth = getFirebaseAuth();
      await firebaseSignOut(auth);
      setCurrentUser(null);
      setRole(null);
    },
  }), [currentUser, initializationError, loading, role]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error('useAuth must be used inside AuthProvider.');
  }

  return context;
}
