import assert from 'node:assert/strict';
export function assertFinalPayload(raw, expectedRows, mode) {
  const safe = ['sessionId','status','quizTitle','slidePosition','answerRevealed','presentationMode','renderMode','mediaCommand','mediaPlaybackState','mediaGeneration','introGeneration','revision','updatedAt','finalReveal'];
  assert(Object.keys(raw).every(k => safe.includes(k)), 'Unexpected public field');
  assert.equal(raw.status, 'active'); assert.equal(raw.answerRevealed, false); assert.equal(raw.mediaPlaybackState, 'idle');
  const finalKeys = ['versionId','mode','rank','page','pageCount','groupSize','rows','presentationStyle','pageSize'];
  assert(Object.keys(raw.finalReveal).every(k => finalKeys.includes(k)), 'Unexpected final field');
  assert(['versionId','mode','rank','page','pageCount','groupSize','rows'].every(k => Object.hasOwn(raw.finalReveal, k)), 'Missing final field');
  const style = raw.finalReveal.presentationStyle ?? 'classic', size = raw.finalReveal.pageSize ?? 8;
  assert((style === 'classic' && size === 8) || (style === 'show' && size === 6), 'Invalid result pagination');
  assert(raw.finalReveal.rows.length <= size, 'Oversized public page');
  assert.equal(raw.finalReveal.mode, mode);
  assert.deepEqual(raw.finalReveal.rows, expectedRows);
  for (const row of raw.finalReveal.rows) assert.deepEqual(Object.keys(row).sort(), ['rank','teamName','halfPoints'].sort());
  assert(!/PRIVATE|actorUid|staffUid|snapshotId|sourceFingerprint|contactEmail|teamId|accessId|managementToken|correctAnswer/.test(JSON.stringify(raw)));
}
