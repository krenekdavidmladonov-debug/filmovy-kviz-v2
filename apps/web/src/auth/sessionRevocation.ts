import { httpsCallable } from 'firebase/functions';
import { getFirebaseServices } from '../services/firebase/client';
const key = 'justkviz-sign-in-after';
export async function revokeSessions(): Promise<void> {
  await httpsCallable(getFirebaseServices().functions, 'revokeMySessions')({});
  // Auth tokens use whole seconds. Wait past the inclusive cutoff before a new login.
  // This timestamp is UX state only; server membership/Rules remain the authority.
  try { sessionStorage.setItem(key, String(Date.now() + 1100)); } catch { /* Browser storage may be unavailable. */ }
}
export async function waitForSignInWindow(): Promise<void> {
  let remaining = 0;
  try { remaining = Math.min(1100, Number(sessionStorage.getItem(key)) - Date.now()); sessionStorage.removeItem(key); } catch { /* No stored delay. */ }
  if (remaining > 0) await new Promise<void>(resolve => setTimeout(resolve, remaining));
}
