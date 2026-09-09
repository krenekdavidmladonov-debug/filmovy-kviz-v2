import { getFirestore, Timestamp, type Transaction } from 'firebase-admin/firestore';
import { parseSession } from './callables.js';
import { applyLiveSessionAction } from './session-machine.js';
import { buildPublicSessionState } from './publication.js';
// Called before event writes, in that same transaction. No results survive closure.
export async function closeEventPresentation(tx: Transaction, eventId: string, actorUid: string): Promise<void> {
    const db = getFirestore();
    const event = (await tx.get(db.doc('events/' + eventId))).data();
    if (typeof event?.liveSessionId !== 'string')
        return;
    const ref = db.doc('sessions/' + event.liveSessionId);
    const snapshot = await tx.get(ref);
    if (!snapshot.exists)
        return;
    const session = parseSession(snapshot);
    if (session.eventId !== eventId)
        throw new Error('Event/session binding is invalid.');
    if (session.status === 'ended')
        return;
    const { interimResults, ...clean } = session;
    void interimResults;
    const ended = applyLiveSessionAction(clean, { type: 'end-session' }, session.revision, actorUid, Timestamp.now());
    tx.set(ref, ended);
    tx.set(db.doc('publicSessions/' + session.sessionId), buildPublicSessionState(ended));
}
