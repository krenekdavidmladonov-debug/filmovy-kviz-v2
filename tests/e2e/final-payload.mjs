import assert from 'node:assert/strict';
export function assertFinalPayload(raw, expectedRows, mode) {
  const safe = ['sessionId','status','quizTitle','slidePosition','answerRevealed','presentationMode','renderMode','mediaCommand','mediaPlaybackState','mediaGeneration','introGeneration','revision','updatedAt','finalReveal'];
  assert(Object.keys(raw).every(k => safe.includes(k)), 'Unexpected public field');
  assert.equal(raw.status, 'active'); assert.equal(raw.answerRevealed, false); assert.equal(raw.mediaPlaybackState, 'idle');
  assert.deepEqual(Object.keys(raw.finalReveal).sort(), ['versionId','mode','rank','page','pageCount','groupSize','rows'].sort());
  assert.equal(raw.finalReveal.mode, mode);
  assert.deepEqual(raw.finalReveal.rows, expectedRows);
  for (const row of raw.finalReveal.rows) assert.deepEqual(Object.keys(row).sort(), ['rank','teamName','halfPoints'].sort());
  assert(!/PRIVATE|actorUid|staffUid|snapshotId|sourceFingerprint|contactEmail|teamId|accessId|managementToken|correctAnswer/.test(JSON.stringify(raw)));
}
