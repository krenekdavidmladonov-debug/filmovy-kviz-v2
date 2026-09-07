import { describe, expect, it } from 'vitest';
import jsQR from 'jsqr';
import { PNG } from 'pngjs';
import { Timestamp } from 'firebase/firestore';
import { manualTeamInput, registrationInput } from '../functions/src/registrations/validation';
import { registrationToPrintTeam } from '../functions/src/registrations/print-adapter';
import { mapRegistration } from '../apps/web/src/features/events/eventMappers';
import { publicRegistrationUrl, registrationQr, registrationSharingState, qrFilename } from '../apps/web/src/features/events/registrationSharing';
import { effectiveRegistrationStatus } from '../functions/src/registrations/domain';
import type { EventRecord } from '../apps/web/src/features/events/types';

describe('event team tools contracts', () => {
  it('allows a genuinely absent manual email, still validates supplied email and public input', () => {
    expect(manualTeamInput({ teamName: '  Ruční   Tým ', memberCount: 2 }).contactEmail).toBeNull();
    expect(manualTeamInput({ teamName: '  Ruční   Tým ', memberCount: 2 }).normalizedTeamName).toBe('ruční tým');
    expect(() => manualTeamInput({ teamName: 'Tým', memberCount: 2, contactEmail: 'wrong' })).toThrow();
    expect(() => registrationInput({ teamName: 'Tým', memberCount: 2, source: 'manual' })).toThrow();
  });
  it('maps nullable/missing manual email, preserves old online records, excludes private data from print', () => {
    const data = { eventId: 'synthetic-event', teamName: 'Manual', memberCount: 2, status: 'accepted', source: 'manual', createdAt: Timestamp.now(), updatedAt: Timestamp.now(), managementTokenHash: null, createdBy: 'private-staff' };
    expect(mapRegistration('manual', data).contactEmail).toBeNull();
    expect(mapRegistration('old-online', { ...data, source: undefined, contactEmail: 'test@example.test' }).source).toBe('online');
    expect(registrationToPrintTeam('manual', data)).toEqual({ id: 'manual', name: 'Manual' });
    expect(registrationToPrintTeam('manual', { ...data, status: 'cancelled' })).toBeUndefined();
  });
  it('constructs only the verified environment public URL', () => {
    const staging = { projectId: 'filmovy-kviz-v2-staging', useEmulators: false };
    expect(publicRegistrationUrl('synthetic-event', staging, 'http://localhost:5173')).toBe('https://filmovy-kviz-v2-staging.web.app/events/synthetic-event');
    expect(publicRegistrationUrl('demo-event', { projectId: 'demo-test', useEmulators: true }, 'http://127.0.0.1:5173')).toBe('http://127.0.0.1:5173/events/demo-event');
    for (const id of ['../admin', 'event#token=secret', 'event?token=secret']) expect(() => publicRegistrationUrl(id, staging, '')).toThrow();
    expect(() => publicRegistrationUrl('event', { projectId: 'unknown', useEmulators: false }, '')).toThrow();
    expect(() => publicRegistrationUrl('event', { projectId: 'demo-test', useEmulators: true }, 'https://external.example')).toThrow();
  });
  it('decodes generated PNG to exactly the public URL with opaque white quiet zone; SVG is local', async () => {
    const url = publicRegistrationUrl('synthetic-event', { projectId: 'filmovy-kviz-v2-staging', useEmulators: false }, '');
    const qr = await registrationQr(url);
    const png = PNG.sync.read(Buffer.from(qr.png.split(',')[1]!, 'base64'));
    expect(jsQR(new Uint8ClampedArray(png.data), png.width, png.height)?.data).toBe(url);
    for (let y = 0; y < 32; y++) for (let x = 0; x < png.width; x++) expect([...png.data.subarray((y * png.width + x) * 4, (y * png.width + x) * 4 + 4)]).toEqual([255, 255, 255, 255]);
    expect(decodeURIComponent(qr.svg)).toContain('<svg');
    expect(decodeURIComponent(qr.svg)).not.toContain('http://localhost');
    expect(qrFilename('../../Příliš / dlouhý název')).toMatch(/^registrace-[A-Za-z0-9_-]+$/u);
  });
  it('shows current time/capacity states consistently with the existing server and mutates nothing', () => {
    const base = { registrationPublished: true, lifecycleStatus: 'ready', registrationOpensAt: new Date(1000), registrationClosesAt: new Date(3000), acceptedTeams: 0, acceptedPeople: 0, teamCapacity: 2, peopleCapacity: 6 } as EventRecord;
    const before = JSON.stringify(base);
    for (const lifecycleStatus of ['draft', 'ready', 'live', 'finalizing', 'completed', 'cancelled', 'archived'] as const) {
      for (const now of [500, 2000, 4000]) {
        const event = { ...base, lifecycleStatus };
        const effective = effectiveRegistrationStatus({ published: true, lifecycleStatus, opensAtMillis: 1000, closesAtMillis: 3000, nowMillis: now, capacity: { acceptedTeams: 0, acceptedPeople: 0, maximumTeams: 2, maximumPeople: 6 } });
        expect(registrationSharingState(event, now).message === 'Přihlášky jsou otevřené.').toBe(effective === 'open');
      }
    }
    expect(registrationSharingState({ ...base, registrationPublished: false }, 2000).available).toBe(false);
    expect(JSON.stringify(base)).toBe(before);
  });
});
