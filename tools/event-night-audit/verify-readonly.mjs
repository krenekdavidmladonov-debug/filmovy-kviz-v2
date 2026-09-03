import { readFile, writeFile } from 'node:fs/promises';

import { assertAuditEnvironment, auditPaths } from './config.mjs';
import { loadCandidateState, publicSessionCount, stateFingerprint, withAuditFirestore } from './candidate-state.mjs';

async function main() {
  const { projectId } = assertAuditEnvironment();
  const paths = auditPaths();
  const before = JSON.parse(await readFile(paths.beforeState, 'utf8'));
  const after = await withAuditFirestore(projectId, async (db) => ({
    candidate: await loadCandidateState(db, before.quizId),
    publicSessions: await publicSessionCount(db),
    candidateSessions: (await db.collection('sessions').where('quizId', '==', before.quizId).get()).size,
  }));
  const revision = typeof after.candidate.quiz.data.revision === 'number' ? after.candidate.quiz.data.revision : 0;
  const fingerprint = stateFingerprint(after.candidate);
  const unchanged = before.fingerprint === fingerprint && before.revision === revision;
  const publicUntouched = after.candidateSessions === 0;
  const report = {
    status: unchanged && publicUntouched ? 'PASS' : 'FAIL',
    revisionBefore: before.revision,
    revisionAfter: revision,
    candidateUnchanged: unchanged,
    publicSessionsBefore: before.publicSessionCount,
    publicSessionsAfter: after.publicSessions,
    candidateSessionsAfter: after.candidateSessions,
    publicSessionsUntouched: publicUntouched,
  };
  await writeFile(`${paths.localRoot}/readonly-verification.json`, `${JSON.stringify({
    ...report,
    fingerprintBefore: before.fingerprint,
    fingerprintAfter: fingerprint,
  }, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(report));
  if (report.status !== 'PASS') process.exitCode = 1;
}

await main();
