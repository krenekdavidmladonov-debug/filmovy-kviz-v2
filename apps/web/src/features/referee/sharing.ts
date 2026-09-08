import QRCode from 'qrcode';
import type { Credential } from './api';
import { publicRegistrationUrl } from '../events/registrationSharing';
export function refereeUrl(credential: Credential, config: { projectId: string; useEmulators: boolean }, origin: string) {
  if (!/^[A-Za-z0-9_-]{1,150}$/u.test(credential.accessId) || !/^[A-Za-z0-9_-]{43}$/u.test(credential.key)) throw new Error('Neplatný přístup.');
  const base = new URL(publicRegistrationUrl(credential.eventId, config, origin));
  return base.origin + '/referee/' + credential.eventId + '#access=' + credential.accessId + '&key=' + credential.key;
}
export const refereeQr = (url: string) => QRCode.toDataURL(url, { margin: 4, scale: 8, errorCorrectionLevel: 'M' });
const storageKey = (eventId: string) => 'referee-access-v1:' + eventId;
export function consumeRefereeCredential(eventId: string): Credential | null {
  const fragment = window.location.hash;
  // Remove secrets before SDK requests, including invalid inputs. replaceState also removes this history entry's fragment.
  if (fragment) window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
  const input = new URLSearchParams(fragment.slice(1));
  if (fragment) {
    const accessId = input.get('access') ?? '', key = input.get('key') ?? '';
    if (!/^[A-Za-z0-9_-]{1,150}$/u.test(accessId) || !/^[A-Za-z0-9_-]{43}$/u.test(key)) { sessionStorage.removeItem(storageKey(eventId)); return null; }
    const c = { eventId, accessId, key }; sessionStorage.setItem(storageKey(eventId), JSON.stringify(c)); return c;
  }
  try { const data = JSON.parse(sessionStorage.getItem(storageKey(eventId)) ?? 'null') as Credential | null;
    return data?.eventId === eventId && /^[A-Za-z0-9_-]{1,150}$/u.test(data.accessId) && /^[A-Za-z0-9_-]{43}$/u.test(data.key) ? data : null;
  } catch { return null; }
}
export function forgetReferee(eventId: string) { sessionStorage.removeItem(storageKey(eventId)); }
