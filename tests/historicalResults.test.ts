import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Timestamp } from 'firebase/firestore';
import { getHistoricalResults } from '../apps/web/src/features/events/historicalResultsRepository';

const mocks = vi.hoisted(() => ({ event: vi.fn(), read: vi.fn<(key: string) => Promise<{ exists: () => boolean; data: () => Record<string, unknown> | undefined }>>() }));
vi.mock('../apps/web/src/features/events/eventRepository', () => ({ getEvent: mocks.event }));
vi.mock('../apps/web/src/services/firebase/firestore', () => ({ getFirebaseFirestore: () => ({}) }));
vi.mock('firebase/firestore', async importOriginal => ({ ...await importOriginal<typeof import('firebase/firestore')>(),
  doc: (_db: unknown, ...parts: string[]) => parts.join('/'), getDocFromServer: mocks.read,
}));
const versionId = 'a'.repeat(64), path = `sessions/session/finalVersions/${versionId}`;
const rows = [{ rank: 1, teamName: 'Alfa', halfPoints: 34 }, { rank: 2, teamName: 'Beta', halfPoints: 26 },
  { rank: 3, teamName: 'Delta', halfPoints: 19 }, { rank: 4, teamName: 'Gamma', halfPoints: 6 }];
let documents: Map<string, Record<string, unknown>>;
const completed = () => ({ id: 'event', title: 'Odehraný večer', lifecycleStatus: 'completed', liveSessionId: 'session', quizAssignment: { snapshotId: 'snapshot', quizId: 'library', quizRevision: 30 } });
beforeEach(() => {
  mocks.event.mockReset().mockResolvedValue(completed());
  documents = new Map([
    ['sessions/session', { status: 'ended', eventId: 'event', snapshotId: 'snapshot', finalReveal: { versionId }, endedAt: Timestamp.fromMillis(1000) }],
    [path, { versionId, eventId: 'event', sessionId: 'session', snapshotId: 'snapshot', rows }],
  ]);
  mocks.read.mockReset().mockImplementation((key: string) => Promise.resolve({ exists: () => documents.has(key), data: () => documents.get(key) }));
});
describe('confirmed historical authority', () => {
  it('reads only the ended session and its exact confirmed version, preserving ranks, names and half-points', async () => {
    const before = structuredClone([...documents]);
    expect(await getHistoricalResults('event')).toEqual({ status: 'available', eventTitle: 'Odehraný večer', rows, completedAt: new Date(1000) });
    expect(mocks.read.mock.calls.map(c => c[0])).toEqual(['sessions/session', path]);
    expect(structuredClone([...documents])).toEqual(before);
  });
  it('ignores a later library revision, changed scores and a removed registration', async () => {
    const original = await getHistoricalResults('event');
    documents.set('quizzes/library', { revision: 31, title: 'Nový obsah' });
    documents.set('events/event/scores/changed', { halfPoints: 999 });
    documents.delete('events/event/registrations/old-team');
    mocks.read.mockClear();
    expect(await getHistoricalResults('event')).toEqual(original);
    expect(mocks.read.mock.calls.map(c => c[0])).toEqual(['sessions/session', path]);
  });
  it('reload returns the same confirmed table without a new version', async () => {
    expect(await getHistoricalResults('event')).toEqual(await getHistoricalResults('event'));
    expect([...documents.keys()]).toEqual(['sessions/session', path]);
  });
  it.each(['ready', 'live', 'finalizing', 'cancelled', 'archived'])('does not read historical documents for %s lifecycle', async lifecycleStatus => {
    mocks.event.mockResolvedValue({ ...completed(), lifecycleStatus });
    expect((await getHistoricalResults('event')).status).toBe('not-completed');
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it.each(['trash', 'deleting'])('does not read a %s event', async disposition => {
    mocks.event.mockResolvedValue({ ...completed(), disposition });
    expect((await getHistoricalResults('event')).status).toBe('unavailable');
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it.each(['missing-version', 'missing-pointer', 'missing-session', 'empty', 'missing-name', 'invalid-points', 'wrong-event', 'wrong-session', 'wrong-snapshot', 'wrong-version', 'active-session'])('fails closed for %s without reconstructing results', async scenario => {
    const session = documents.get('sessions/session')!, version = documents.get(path)!;
    if (scenario === 'missing-version') documents.delete(path);
    if (scenario === 'missing-pointer') delete session.finalReveal;
    if (scenario === 'missing-session') documents.delete('sessions/session');
    if (scenario === 'empty') version.rows = [];
    if (scenario === 'missing-name') version.rows = [{ rank: 1, halfPoints: 34 }];
    if (scenario === 'invalid-points') version.rows = [{ rank: 1, teamName: 'Alfa', halfPoints: NaN }];
    if (scenario === 'wrong-event') version.eventId = 'another';
    if (scenario === 'wrong-session') version.sessionId = 'another';
    if (scenario === 'wrong-snapshot') version.snapshotId = 'another';
    if (scenario === 'wrong-version') version.versionId = 'b'.repeat(64);
    if (scenario === 'active-session') session.status = 'active';
    expect((await getHistoricalResults('event')).status).toBe('unavailable');
  });
  it('propagates current permission denial instead of presenting missing data or cached results', async () => {
    const denied = Object.assign(new Error('denied'), { code: 'permission-denied' });
    mocks.read.mockRejectedValue(denied);
    await expect(getHistoricalResults('event')).rejects.toBe(denied);
  });
});
