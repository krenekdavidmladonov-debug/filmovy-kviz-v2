import QRCode from 'qrcode';
import type { EventRecord } from './types';

export function publicRegistrationUrl(eventId: string, config: { projectId: string; useEmulators: boolean }, localOrigin: string): string {
  if (!/^[A-Za-z0-9_-]{1,1500}$/u.test(eventId)) throw new Error('Neplatné ID akce.');
  let origin: string;
  if (!config.useEmulators && config.projectId === 'filmovy-kviz-v2-staging') origin = 'https://justkviz-v2.web.app';
  else if (config.useEmulators && config.projectId.startsWith('demo-')) {
    const local = new URL(localOrigin);
    if (!['localhost', '127.0.0.1', '[::1]'].includes(local.hostname) || !['http:', 'https:'].includes(local.protocol) || local.username || local.password) throw new Error('Neplatný lokální origin.');
    origin = local.origin;
  } else throw new Error('Veřejný origin není nakonfigurován.');
  return `${origin}/events/${eventId}`;
}

export function registrationSharingState(event: EventRecord, now = Date.now()) {
  const available = event.registrationPublished && !['cancelled', 'archived'].includes(event.lifecycleStatus);
  const open = available
    && event.registrationOpensAt !== undefined && event.registrationClosesAt !== undefined
    && now >= event.registrationOpensAt.getTime() && now < event.registrationClosesAt.getTime()
    && event.acceptedTeams < event.teamCapacity && event.acceptedPeople < event.peopleCapacity;
  return { available, message: !available ? 'Akce nemá zveřejněné přihlášení.' : open ? 'Přihlášky jsou otevřené.' : 'Stránka je dostupná, přihlášky jsou nyní uzavřené.' };
}

export const registrationQrOptions = { margin: 4, scale: 8, errorCorrectionLevel: 'M' as const, color: { dark: '#000000ff', light: '#ffffffff' } };
export async function registrationQr(url: string) {
  const [png, svg] = await Promise.all([QRCode.toDataURL(url, registrationQrOptions), QRCode.toString(url, { ...registrationQrOptions, type: 'svg' })]);
  return { png, svg: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg) };
}
export function qrFilename(title: string) { return 'registrace-' + (title.normalize('NFKD').replace(/[\u0300-\u036f]/gu, '').replace(/[^a-zA-Z0-9_-]+/gu, '-').slice(0,60) || 'akce'); }
