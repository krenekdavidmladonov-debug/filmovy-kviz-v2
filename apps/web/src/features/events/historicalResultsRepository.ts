import { eventDisposition } from '@filmovy-kviz/quiz-domain';
import { doc, getDocFromServer, Timestamp } from 'firebase/firestore';
import { getFirebaseFirestore } from '../../services/firebase/firestore';
import type { ResultRow } from '../leaderboard/types';
import { getEvent } from './eventRepository';

export type HistoricalResults =
  | { status: 'not-completed' | 'unavailable'; eventTitle: string }
  | { status: 'available'; eventTitle: string; completedAt: Date | null; rows: readonly ResultRow[] };

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const documentId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 1500 && !value.includes('/');

function confirmedRows(value: unknown): readonly ResultRow[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 1000) return null;
  const rows: ResultRow[] = [];
  for (const item of value) {
    const row = record(item);
    if (!row || typeof row.teamName !== 'string' || !row.teamName.trim()
      || !Number.isSafeInteger(row.rank) || Number(row.rank) < 1
      || !Number.isSafeInteger(row.halfPoints) || Number(row.halfPoints) < 0) return null;
    rows.push({ rank: Number(row.rank), teamName: row.teamName, halfPoints: Number(row.halfPoints) });
  }
  return rows;
}

/** Only the version explicitly referenced by the ended session is historical authority.
 * No roster, scores, source quiz, publication callable or write is involved.
 * Server reads enforce the existing event.read permission and event scope in Rules.
 */
export async function getHistoricalResults(eventId: string): Promise<HistoricalResults> {
  const event = await getEvent(eventId);
  const unavailable: HistoricalResults = { status: 'unavailable', eventTitle: event?.title ?? 'Akce' };
  if (!event || ['trash', 'deleting'].includes(eventDisposition(event))) return unavailable;
  if (event.lifecycleStatus !== 'completed') return { status: 'not-completed', eventTitle: event.title };
  if (!documentId(event.liveSessionId) || !documentId(event.quizAssignment?.snapshotId)) return unavailable;
  const db = getFirebaseFirestore();
  const sessionDoc = await getDocFromServer(doc(db, 'sessions', event.liveSessionId));
  if (!sessionDoc.exists()) return unavailable;
  const session = sessionDoc.data();
  const versionId = record(session.finalReveal)?.versionId;
  if (session.status !== 'ended' || session.eventId !== eventId || session.snapshotId !== event.quizAssignment.snapshotId
    || typeof versionId !== 'string' || !/^[a-f0-9]{64}$/u.test(versionId)) return unavailable;
  const versionDoc = await getDocFromServer(doc(db, 'sessions', event.liveSessionId, 'finalVersions', versionId));
  if (!versionDoc.exists()) return unavailable;
  const version = versionDoc.data();
  if (version.versionId !== versionId || version.eventId !== eventId || version.sessionId !== event.liveSessionId
    || version.snapshotId !== event.quizAssignment.snapshotId) return unavailable;
  const rows = confirmedRows(version.rows);
  if (!rows) return unavailable;
  return { status: 'available', eventTitle: event.title, rows,
    completedAt: session.endedAt instanceof Timestamp ? session.endedAt.toDate() : null };
}
