import { randomUUID } from 'node:crypto';
import { doc, getDocFromServer } from 'firebase/firestore';
import { leaderboardFixture } from './leaderboard-fixture.mjs';
// The reused fixture fails closed before SDK initialization: demo-* and all local emulators.
export async function finalFixture(count = 13, oneRound = false, allTied = false) {
  const f = await leaderboardFixture(count);
  const scores = await f.db.collection(`events/${f.eventId}/scores`).get();
  for (const score of scores.docs) {
    if (score.data().roundId === 'r3' || allTied) await score.ref.update({ halfPoints: 0 });
  }
  if (oneRound) for (const round of ['r2', 'r3']) await f.db.doc(`quizSnapshots/${f.snapshotId}/rounds/${round}`).delete();
  await f.db.doc(`quizSnapshots/${f.snapshotId}/slides/s5`).set({ position: 5, kind: 'recap', isQuestion: false, roundId: 'r3', title: 'Poslední recap', text: '', options: [], media: [] });
  await f.db.doc(`quizSnapshots/${f.snapshotId}/slides/s6`).set({ position: 6, kind: 'end', isQuestion: false, title: 'Závěr prezentace', text: 'END zůstává ruční', options: [], media: [] });
  await f.db.doc(`quizSnapshots/${f.snapshotId}`).update({ slideCount: 6 });
  await f.db.doc(`sessions/${f.sessionId}`).update({ slideCount: 6 });
  const command = async (action, extra = {}, client = f.moderator) => {
    const s = await f.session();
    return client.call('controlFinalReveal', { eventId: f.eventId, sessionId: f.sessionId, requestId: randomUUID(), action, expectedRevision: s.revision, versionId: s.finalReveal?.versionId ?? null, ...extra });
  };
  const previewFinal = () => f.call('previewFinalResults', { eventId: f.eventId, sessionId: f.sessionId });
  const startFinal = async (p, action = 'start') => command(action, { expectedRevision: p.sessionRevision, versionId: p.publishedVersionId, sourceFingerprint: p.sourceFingerprint });
  return { ...f, command, previewFinal, startFinal,
    rawPublic: async () => (await getDocFromServer(doc(f.anonymous.store, 'publicSessions', f.sessionId))).data(),
  };
}
