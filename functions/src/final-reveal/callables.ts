import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { securedOnCall, runAccessTransaction } from '../access/authorization.js';
import { bound, id, object, previewIn, revision, staff } from '../leaderboard/callables.js';
import { fingerprint, type ResultRow } from '../leaderboard/model.js';
import { authorizeStaff, loadSlide } from '../live/callables.js';
import { applyLiveSessionAction } from '../live/session-machine.js';
import { buildPublicSessionState, publicResultTemplate } from '../live/publication.js';
import { advanceFinal, initialFinal, publicFinalPage, type FinalAction } from './model.js';
const options = { region: 'europe-west1', cors: true, maxInstances: 10 };

export const previewFinalResults = securedOnCall('previewFinalResults', options, async request => {
  const data = object(request.data);
  if (Object.keys(data).some(k => !['eventId', 'sessionId'].includes(k))) throw new HttpsError('invalid-argument', 'Nepovolená pole.');
  return runAccessTransaction(getFirestore(), async tx => {
    await staff(request);
    const { session, result } = await previewIn(tx, id(data, 'eventId'), id(data, 'sessionId'), null);
    return { ...result, sessionRevision: session.revision, publishedVersionId: session.finalReveal?.versionId ?? null };
  });
});

interface FinalResponse { sessionId: string; versionId: string; revision: number; winnerRevealed: boolean; replayed: boolean }
export const controlFinalReveal = securedOnCall('controlFinalReveal', options, async request => {
  const uid = authorizeStaff(request.auth).uid, data = object(request.data);
  const eventId = id(data, 'eventId'), sessionId = id(data, 'sessionId'), requestId = id(data, 'requestId');
  const action = data.action as FinalAction, expected = revision(data);
  if (!['start', 'replace', 'reveal', 'hide', 'resume', 'page', 'table'].includes(action)) throw new HttpsError('invalid-argument', 'Neplatný příkaz finále.');
  const confirming = action === 'start' || action === 'replace';
  const allowed = ['eventId', 'sessionId', 'requestId', 'action', 'expectedRevision', 'versionId', ...(confirming ? ['sourceFingerprint'] : action === 'page' ? ['page'] : [])];
  if (Object.keys(data).some(k => !allowed.includes(k)) || (data.versionId !== null && (typeof data.versionId !== 'string' || !/^[a-f0-9]{64}$/u.test(data.versionId)))) throw new HttpsError('invalid-argument', 'Neplatná verze nebo nepovolená pole.');
  if (confirming && (typeof data.sourceFingerprint !== 'string' || !/^[a-f0-9]{64}$/u.test(data.sourceFingerprint))) throw new HttpsError('invalid-argument', 'Chybí potvrzený náhled.');
  const db = getFirestore(), ref = db.doc('sessions/' + sessionId);
  const operationId = fingerprint([uid, sessionId, requestId]);
  const receiptRef = ref.collection('finalOperations').doc(operationId);
  const commandFingerprint = fingerprint([eventId, sessionId, action, expected, data.versionId, data.sourceFingerprint ?? null, data.page ?? null]);
  return runAccessTransaction(db, async tx => {
    await staff(request); // Current role, including every transaction retry.
    const { session } = await bound(tx, eventId, sessionId);
    const receipt = (await tx.get(receiptRef)).data();
    if (receipt) {
      if (receipt.fingerprint !== commandFingerprint) throw new HttpsError('already-exists', 'Request ID má jiný obsah.');
      // Historical acknowledgment only: no replayed mutation or sound authorization.
      return { ...(receipt.response as FinalResponse), replayed: true, winnerRevealed: false };
    }
    if (session.revision !== expected || (session.finalReveal?.versionId ?? null) !== data.versionId) throw new HttpsError('aborted', 'Verze nebo prezentace se změnila. Načtěte aktuální stav.');
    if (session.status !== 'active') throw new HttpsError('failed-precondition', 'Nejprve spusťte prezentaci.');
    const now = Timestamp.now();
    let publication: Record<string, unknown> | undefined;
    let rows: ResultRow[];
    let state;
    if (confirming) {
      if ((action === 'start') !== !session.finalReveal) throw new HttpsError('failed-precondition', 'Existující finále vyžaduje výslovné nahrazení.');
      const { result } = await previewIn(tx, eventId, sessionId, null);
      if (!result.complete) throw new HttpsError('failed-precondition', 'Neúplné nebo prázdné finále nelze zahájit.');
      if (result.sourceFingerprint !== data.sourceFingerprint) throw new HttpsError('aborted', 'Náhled je zastaralý. Načtěte nový a zkontrolujte jej.');
      rows = result.rows;
      state = initialFinal(operationId, rows);
      publication = { eventId, sessionId, snapshotId: session.snapshotId, versionId: operationId, rows,
        sourceFingerprint: result.sourceFingerprint, includedRounds: result.includedRounds, actorUid: uid, createdAt: now,
        replacesVersionId: session.finalReveal?.versionId ?? null };
    } else {
      if (!session.finalReveal) throw new HttpsError('failed-precondition', 'Finále ještě nebylo potvrzeno.');
      const saved = (await tx.get(ref.collection('finalVersions').doc(session.finalReveal.versionId))).data();
      if (!saved || saved.eventId !== eventId || saved.sessionId !== sessionId || saved.snapshotId !== session.snapshotId) throw new HttpsError('failed-precondition', 'Potvrzená verze chybí.');
      rows = saved.rows as ResultRow[];
      state = advanceFinal(session.finalReveal, rows, action, data.page as number | undefined);
    }
    // Reset existing reveal/recap/media lifecycle on entry, hiding and resuming.
    const slide = await loadSlide(tx, session.quizId, session.currentSlidePosition, session.snapshotId);
    const { interimResults, ...clean } = session; void interimResults;
    const reset = confirming || action === 'hide' || action === 'resume';
    const updated = { ...(reset ? applyLiveSessionAction(clean, { type: 'go-to-slide', position: session.currentSlidePosition, slideId: slide.id }, expected, uid, now, slide)
      : { ...clean, revision: expected + 1, updatedBy: uid, updatedAt: now }), finalReveal: state };
    const publicState = state.visible ? {
      ...buildPublicSessionState({ ...updated, status: 'waiting', presentationMode: 'slide', answerRevealed: false }), status: 'active',
      ...publicResultTemplate((await tx.get(db.doc('quizSnapshots/' + session.snapshotId))).data() ?? {}, 'final'),
      finalReveal: publicFinalPage(state, rows),
    } : buildPublicSessionState(updated, slide);
    const response: FinalResponse = { sessionId, versionId: state.versionId, revision: updated.revision, winnerRevealed: action === 'reveal' && state.rank === 1, replayed: false };
    if (publication) tx.create(ref.collection('finalVersions').doc(operationId), publication);
    tx.set(ref, updated);
    tx.set(db.doc('publicSessions/' + sessionId), publicState);
    tx.create(receiptRef, { fingerprint: commandFingerprint, response, actorUid: uid, createdAt: now, eventId, action, versionId: state.versionId });
    return response;
  });
});
