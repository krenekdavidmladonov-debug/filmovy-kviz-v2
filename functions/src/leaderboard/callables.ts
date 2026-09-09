import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp, type Transaction } from 'firebase-admin/firestore';
import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/v2/https';
import { authorizeStaff, parseSession, loadSlide } from '../live/callables.js';
import { buildPublicSessionState } from '../live/publication.js';
import { applyLiveSessionAction } from '../live/session-machine.js';
import type { PrivateLiveSession } from '../live/types.js';
import { calculateResults, calculateFinalResults, fingerprint, RESULTS_PAGE_SIZE, type ResultRow } from './model.js';
const options = { region: 'europe-west1', cors: true, maxInstances: 10 };
const db = () => getFirestore();
export function object(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new HttpsError('invalid-argument', 'Neplatný požadavek.');
    return value as Record<string, unknown>;
}
export function id(data: Record<string, unknown>, key: string): string {
    const value = data[key];
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,150}$/u.test(value))
        throw new HttpsError('invalid-argument', 'Neplatný identifikátor.');
    return value;
}
export function revision(data: Record<string, unknown>): number {
    if (!Number.isSafeInteger(data.expectedRevision) || (data.expectedRevision as number) < 0)
        throw new HttpsError('invalid-argument', 'Neplatná revize.');
    return data.expectedRevision as number;
}
export async function staff(request: CallableRequest) {
    const actor = authorizeStaff(request.auth);
    const current = await getAuth().getUser(actor.uid).catch(() => null);
    if (!current || current.disabled || !['admin', 'moderator'].includes(current.customClaims?.role as string))
        throw new HttpsError('permission-denied', 'Aktuální staff oprávnění je nutné.');
    return actor.uid;
}
async function eventIn(tx: Transaction, eventId: string) {
    const event = (await tx.get(db().doc('events/' + eventId))).data();
    if (!event || !['ready', 'live', 'finalizing'].includes(event.lifecycleStatus as string))
        throw new HttpsError('failed-precondition', 'Akce není dostupná pro moderování.');
    return event;
}
export async function bound(tx: Transaction, eventId: string, sessionId: string) {
    const event = await eventIn(tx, eventId);
    const session = parseSession(await tx.get(db().doc('sessions/' + sessionId)));
    if (session.eventId !== eventId || event.liveSessionId !== sessionId || session.snapshotId !== object(event.quizAssignment).snapshotId || session.status === 'ended')
        throw new HttpsError('failed-precondition', 'Akce a aktivní moderování neodpovídají.');
    return { event, session };
}
// One event-bound live session uses the existing presentation path and immutable source.
export const createEventLiveSession = onCall(options, async (request) => {
    const uid = authorizeStaff(request.auth).uid, data = object(request.data), eventId = id(data, 'eventId');
    const sessionRef = db().collection('sessions').doc();
    return db().runTransaction(async (tx) => {
        await staff(request);
        const event = await eventIn(tx, eventId);
        if (typeof event.liveSessionId === 'string') {
            const existing = parseSession(await tx.get(db().doc('sessions/' + event.liveSessionId)));
            if (existing.eventId !== eventId || existing.snapshotId !== object(event.quizAssignment).snapshotId)
                throw new HttpsError('failed-precondition', 'Vazba moderování se změnila.');
            return { sessionId: existing.sessionId };
        }
        if (event.revision !== revision(data))
            throw new HttpsError('aborted', 'Akce se změnila.');
        const snapshotId = id(object(event.quizAssignment), 'snapshotId');
        const snapshot = (await tx.get(db().doc('quizSnapshots/' + snapshotId))).data();
        if (!snapshot || !Number.isSafeInteger(snapshot.slideCount) || (snapshot.slideCount as number) < 1)
            throw new HttpsError('failed-precondition', 'Připravený kvíz chybí.');
        const now = Timestamp.now();
        const session: PrivateLiveSession = {
            sessionId: sessionRef.id, eventId, snapshotId, quizId: String(object(event.quizAssignment).quizId), quizTitle: String(event.title), slideCount: snapshot.slideCount as number,
            status: 'waiting', currentSlidePosition: 0, answerRevealed: false, presentationMode: 'slide',
            mediaCommand: 'idle', mediaPlaybackState: 'idle', mediaGeneration: 0, introGeneration: 0, revision: 0,
            createdBy: uid, updatedBy: uid, createdAt: now, updatedAt: now, startedAt: null, endedAt: null,
        };
        tx.create(sessionRef, session);
        tx.create(db().doc('publicSessions/' + sessionRef.id), buildPublicSessionState(session));
        tx.update(db().doc('events/' + eventId), { liveSessionId: sessionRef.id, revision: (event.revision as number) + 1, updatedAt: now, updatedBy: uid });
        return { sessionId: sessionRef.id };
    });
});
export async function previewIn(tx: Transaction, eventId: string, sessionId: string, throughRoundId: string | null) {
    const { session } = await bound(tx, eventId, sessionId);
    const rounds = await tx.get(db().collection(`quizSnapshots/${session.snapshotId}/rounds`));
    const teams = await tx.get(db().collection(`events/${eventId}/registrations`).where('status', '==', 'accepted'));
    const scores = await tx.get(db().collection(`events/${eventId}/scores`));
    const roundValues = rounds.docs.map(d => ({ id: d.id, title: String(d.data().title), position: Number(d.data().position) }));
    const teamValues = teams.docs.map(d => ({ id: d.id, name: String(d.data().teamName), revision: Number(d.data().revision ?? 0) }));
    const scoreValues = scores.docs.filter(d => d.data().snapshotId === session.snapshotId).map(d => ({ teamId: String(d.data().teamId), roundId: String(d.data().roundId), halfPoints: d.data().halfPoints as number | null, revision: Number(d.data().revision) }));
    const result = throughRoundId === null ? calculateFinalResults(roundValues, teamValues, scoreValues) : calculateResults(roundValues, throughRoundId, teamValues, scoreValues);
    return { session, result: { ...result, sourceFingerprint: fingerprint([eventId, session.snapshotId, result.sourceFingerprint]) } };
}
export const previewInterimResults = onCall(options, async (request) => {
    const data = object(request.data);
    return db().runTransaction(async (tx) => {
        await staff(request);
        const { session, result } = await previewIn(tx, id(data, 'eventId'), id(data, 'sessionId'), id(data, 'throughRoundId'));
        return { ...result, sessionRevision: session.revision, publishedVersionId: session.interimResults?.versionId ?? null };
    });
});
function withoutResults(session: PrivateLiveSession): PrivateLiveSession {
    const { interimResults, ...clean } = session;
    void interimResults;
    return clean;
}
export const controlInterimResults = onCall(options, async (request) => {
    const uid = authorizeStaff(request.auth).uid, data = object(request.data);
    const eventId = id(data, 'eventId'), sessionId = id(data, 'sessionId'), requestId = id(data, 'requestId');
    const action = data.action;
    if (!['publish', 'hide', 'page'].includes(action as string))
        throw new HttpsError('invalid-argument', 'Neplatný příkaz výsledků.');
    const allowed = ['eventId', 'sessionId', 'requestId', 'expectedRevision', 'action', ...(action === 'publish' ? ['throughRoundId', 'sourceFingerprint'] : action === 'page' ? ['page'] : [])];
    if (Object.keys(data).some(k => !allowed.includes(k)))
        throw new HttpsError('invalid-argument', 'Nepovolená pole.');
    const expected = revision(data), operationId = fingerprint([uid, sessionId, requestId]), commandFingerprint = fingerprint([eventId, sessionId, action, data.expectedRevision, data.throughRoundId ?? null, data.sourceFingerprint ?? null, data.page ?? null]);
    const sessionRef = db().doc('sessions/' + sessionId), receiptRef = sessionRef.collection('interimOperations').doc(operationId);
    return db().runTransaction(async (tx) => {
        await staff(request);
        const { session } = await bound(tx, eventId, sessionId);
        const receipt = (await tx.get(receiptRef)).data();
        if (receipt) {
            if (receipt.fingerprint !== commandFingerprint)
                throw new HttpsError('already-exists', 'Request ID má jiný obsah.');
            return receipt.response as {
                sessionId: string;
                revision: number;
            };
        }
        if (session.revision !== expected)
            throw new HttpsError('aborted', 'Prezentace se změnila. Načtěte nový náhled.');
        if (session.status !== 'active')
            throw new HttpsError('failed-precondition', 'Nejprve spusťte prezentaci.');
        if (session.finalReveal?.visible)
            throw new HttpsError('failed-precondition', 'Nejprve skryjte finále.');
        const now = Timestamp.now();
        let updated: PrivateLiveSession;
        let publication: Record<string, unknown> | undefined;
        let rows: ResultRow[] = [];
        if (action === 'publish') {
            const { result } = await previewIn(tx, eventId, sessionId, id(data, 'throughRoundId'));
            if (!result.complete)
                throw new HttpsError('failed-precondition', 'Neúplné nebo prázdné výsledky nelze zveřejnit.');
            if (data.sourceFingerprint !== result.sourceFingerprint)
                throw new HttpsError('aborted', 'Náhled je zastaralý. Načtěte novou podobu.');
            const slide = await loadSlide(tx, session.quizId, session.currentSlidePosition, session.snapshotId);
            // Existing navigation lifecycle stops media, clears recap/reveal, preserves position.
            updated = applyLiveSessionAction(withoutResults(session), { type: 'go-to-slide', position: session.currentSlidePosition, slideId: slide.id }, expected, uid, now, slide);
            rows = result.rows;
            updated = { ...updated, interimResults: { versionId: operationId, roundNumber: result.roundNumber, page: 0, pageCount: Math.ceil(rows.length / RESULTS_PAGE_SIZE) } };
            publication = { eventId, sessionId, snapshotId: session.snapshotId, sourceFingerprint: result.sourceFingerprint, includedRounds: result.includedRounds, rows, actorUid: uid, createdAt: now, versionId: operationId };
        }
        else if (action === 'page') {
            if (!session.interimResults || !Number.isSafeInteger(data.page) || (data.page as number) < 0 || (data.page as number) >= session.interimResults.pageCount)
                throw new HttpsError('invalid-argument', 'Neplatná stránka výsledků.');
            const saved = (await tx.get(sessionRef.collection('interimVersions').doc(session.interimResults.versionId))).data();
            if (!saved || saved.eventId !== eventId || saved.sessionId !== sessionId)
                throw new HttpsError('failed-precondition', 'Verze výsledků chybí.');
            rows = saved.rows as ResultRow[];
            updated = { ...session, revision: expected + 1, updatedAt: now, updatedBy: uid, interimResults: { ...session.interimResults, page: data.page as number } };
        }
        else {
            if (!session.interimResults)
                throw new HttpsError('failed-precondition', 'Výsledky nejsou zobrazené.');
            const slide = await loadSlide(tx, session.quizId, session.currentSlidePosition, session.snapshotId);
            updated = applyLiveSessionAction(withoutResults(session), { type: 'go-to-slide', position: session.currentSlidePosition, slideId: slide.id }, expected, uid, now, slide);
        }
        const slide = action === 'hide' ? await loadSlide(tx, session.quizId, updated.currentSlidePosition, session.snapshotId) : undefined;
        const publicState = action === 'hide' ? buildPublicSessionState(updated, slide) : {
            ...buildPublicSessionState({ ...updated, status: 'waiting', answerRevealed: false, presentationMode: 'slide' }), status: 'active',
            interimResults: { ...updated.interimResults!, rows: rows.slice(updated.interimResults!.page * RESULTS_PAGE_SIZE, (updated.interimResults!.page + 1) * RESULTS_PAGE_SIZE).map(r => ({ rank: r.rank, teamName: r.teamName, halfPoints: r.halfPoints })) },
        };
        const response = { sessionId, revision: updated.revision };
        if (publication)
            tx.create(sessionRef.collection('interimVersions').doc(operationId), publication);
        tx.set(sessionRef, updated);
        tx.set(db().doc('publicSessions/' + sessionId), publicState);
        tx.create(receiptRef, { fingerprint: commandFingerprint, response, actorUid: uid, createdAt: now, eventId, action });
        return response;
    });
});
