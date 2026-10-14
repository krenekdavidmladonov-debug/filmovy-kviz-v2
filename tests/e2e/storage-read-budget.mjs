// Actual Storage Rules evaluator, with synthetic cross-service read responses.
// The emulator does not establish cloud quota/IAM/CORS equivalence. This adapter
// explicitly limits distinct Firestore paths to two and proves the old own-scope
// condition exceeded that budget. Invoked only by the guarded media E2E suite.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { requireFullEmulatorEnvironment, localEmulatorEndpoint } from '../../tools/local-emulator-environment.mjs';

function field(value) {
  if (value === null) return { nullValue: null };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') { assert(Number.isSafeInteger(value)); return { integerValue: String(value) }; }
  if (value instanceof Date || typeof value?.toDate === 'function') return { timestampValue: (value instanceof Date ? value : value.toDate()).toISOString() };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(field) } };
  assert(value && typeof value === 'object'); return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([key, item]) => [key, field(item)])) } };
}
const fields = data => field(data).mapValue.fields;
const jwt = payload => `${Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url')}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.`;

export async function storageReadBudgetContract({ uid, quizId, assetId, member, grant, owner }) {
  const env = requireFullEmulatorEnvironment(process.env, 'Storage Rules read-budget contract');
  localEmulatorEndpoint(process.env.FIREBASE_STORAGE_EMULATOR_HOST, 'Storage Rules read-budget contract');
  assert.equal(member.uid, uid); assert.equal(owner, uid); assert.equal(grant.createdBy, uid); assert.equal(grant.membershipVersion, member.version);
  assert.equal(grant.quizId, quizId); assert.equal(grant.assetId, assetId);
  const require = createRequire(import.meta.url);
  const { StorageRulesRuntime } = require('firebase-tools/lib/emulator/storage/rules/runtime');
  const runtime = new StorageRulesRuntime(), source = readFileSync(new URL('../../storage.rules', import.meta.url), 'utf8');
  let documents = new Map(), lookedUp = new Set();
  // Replace only the cross-service resolver, never the Rules evaluator. No SDK,
  // registry fallback, OAuth or network is involved in these synthetic reads.
  runtime._completeVerifyWithRuleset = async function complete(projectId, request, overrideId) {
    assert.equal(projectId, env.projectId);
    const response = await this._sendRequest(request, overrideId);
    if ('context' in response) {
      const name = response.context.path;
      assert(typeof name === 'string' && name.startsWith('/databases/(default)/documents/'), 'Unexpected cross-service read');
      lookedUp.add(name);
      const data = documents.get(name);
      return complete.call(this, projectId, data === undefined ? { status: 'not_found', warnings: [], errors: [] }
        : { status: 'ok', warnings: [], errors: [], result: { name: `projects/${projectId}${name}`, fields: fields(data) } }, response.server_request_id);
    }
    const actualPermit = response.result?.permit === true;
    return { permitted: actualPermit && lookedUp.size <= 2, actualPermit, paths: [...lookedUp].sort(), budgetExceeded: lookedUp.size > 2, errors: response.errors ?? [] };
  };
  await runtime.start(false); // Cached local evaluator only; never downloads.
  try {
    const current = await runtime.loadRuleset({ files: [{ name: 'storage.rules', content: source }] });
    assert(current.ruleset && current.issues.errors.length === 0, 'Current Rules must compile');
    // Source-bound negative control: reinstate exactly the previous redundant
    // scope proof, leaving the current grant/member allow expression intact.
    const oldScope = `function previousScope() {
      let scope = member().quizzes;
      return scope.mode == 'all' || (scope.mode == 'selected' && quizId in scope.ids)
        || (scope.mode == 'own' && firestore.get(/databases/(default)/documents/quizzes/$(quizId)).data.createdBy == request.auth.uid);
    }`;
    assert.equal(source.split('allow create: if').length, 2);
    const previousSource = source.replace('allow create: if', `${oldScope}\nallow create: if`)
      .replace("&& 'quiz.media.upload' in member().permissions", "&& 'quiz.media.upload' in member().permissions && previousScope()");
    assert.notEqual(previousSource, source);
    const previous = await runtime.loadRuleset({ files: [{ name: 'previous-storage.rules', content: previousSource }] });
    assert(previous.ruleset && previous.issues.errors.length === 0, 'Previous counterexample Rules must compile');
    const memberPath = `/databases/(default)/documents/memberships/${uid}`, grantPath = `/databases/(default)/documents/quizzes/${quizId}/mediaAssets/${assetId}`;
    async function verify(ruleset, currentMember, currentGrant, tokenPatch = {}) {
      lookedUp = new Set(); documents = new Map([[memberPath, currentMember], [grantPath, currentGrant], [`/databases/(default)/documents/quizzes/${quizId}`, { createdBy: owner }]]);
      return ruleset.verify({ method: 'create', path: `/b/${env.projectId}.appspot.com/o/quiz-assets/${quizId}/${assetId}/source`, projectId: env.projectId,
        token: jwt({ user_id: uid, sub: uid, aud: env.projectId, email_verified: true, auth_time: Math.floor(Date.now() / 1000), ...tokenPatch }), file: { after: { size: grant.size, contentType: grant.contentType } } });
    }
    for (const mode of ['own', 'all', 'selected']) {
      const result = await verify(current.ruleset, { ...member, quizzes: { mode, ids: mode === 'selected' ? [quizId] : [] } }, grant);
      assert.equal(result.permitted, true, `Actual ${mode} Rules create must allow`); assert.deepEqual(result.paths, [memberPath, grantPath].sort());
    }
    const old = await verify(previous.ruleset, { ...member, quizzes: { mode: 'own', ids: [] } }, grant);
    assert.equal(old.paths.length, 3, 'Prior own-scope proof must actually request the third document'); assert.equal(old.budgetExceeded, true); assert.equal(old.permitted, false);
    for (const [currentMember, currentGrant, tokenPatch] of [
      [{ ...member, version: member.version + 1, quizzes: { mode: 'none', ids: [] } }, grant, {}],
      [{ ...member, status: 'revoked' }, grant, {}],
      [{ ...member, permissions: member.permissions.filter(permission => permission !== 'quiz.media.upload') }, grant, {}],
      [{ ...member, sessionValidAfter: Math.floor(Date.now() / 1000) + 60 }, grant, {}],
      [member, { ...grant, createdBy: 'foreign-actor' }, {}],
      [member, { ...grant, status: 'ready' }, {}],
      [member, { ...grant, uploadExpiresAt: new Date(0) }, {}],
      [member, grant, { email_verified: false }],
    ]) {
      const result = await verify(current.ruleset, currentMember, currentGrant, tokenPatch); assert.equal(result.permitted, false); assert(result.paths.length <= 2, 'Denied paths also remain bounded');
    }
    console.log('PASS: actual Rules evaluator, own/all/selected two-document paths, prior three-document budget counterexample, revocation and grant denial');
  } finally { await runtime.stop(); }
}
