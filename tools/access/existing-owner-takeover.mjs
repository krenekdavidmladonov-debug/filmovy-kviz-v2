import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { stagingClient } from '../staging/cloud.mjs';
import { legacyStagingAccounts } from './legacy-staging-accounts.mjs';
import { validateApproval, takeover, firestoreTakeoverStore, digest } from './owner-takeover-core.mjs';

const args = process.argv.slice(2), options = {};
for (let i = 0; i < args.length; i++) {
  const key = args[i];
  assert.ok(['--approval', '--qa-retirement', '--apply', '--confirm-plan-sha256'].includes(key) && !(key in options), 'Unknown or duplicate option.');
  if (key === '--apply') options[key] = true;
  else { assert.ok(args[i + 1] && !args[i + 1].startsWith('--'), 'Missing option value.'); options[key] = args[++i]; }
}
assert.ok(options['--approval'] && options['--qa-retirement'], 'Private approval and QA retirement evidence files required. Default is dry-run.');
const approval = JSON.parse(await readFile(options['--approval'], 'utf8'));
const retirement = JSON.parse(await readFile(options['--qa-retirement'], 'utf8'));
const policy = { projectId: 'filmovy-kviz-v2-staging', allowedUid: legacyStagingAccounts.admin };
validateApproval(approval, policy);
assert.equal(digest(retirement), approval.qaRetirementDigest, 'Retirement report digest mismatch.');
assert.ok(Array.isArray(retirement.files) && retirement.files.length > 0, 'Retired credential-file evidence required.');
for (const file of retirement.files) {
  const bytes = await readFile(file.path);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256, 'Retired QA manifest has changed.');
  const slot = JSON.parse(bytes).users?.admin;
  assert.ok(slot?.uid === approval.targetUid && slot.retired === true && !slot.email && !slot.password, 'Legacy personal QA credentials remain.');
}
for (const key of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST', 'FIREBASE_CONFIG', 'GOOGLE_APPLICATION_CREDENTIALS', 'GCLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT']) assert.ok(!process.env[key], 'Unexpected credential or environment override.');
const require = createRequire(import.meta.url), adminRequire = createRequire(new URL('../../functions/package.json', import.meta.url));
await stagingClient('https://firebase.googleapis.com', 'v1beta1');
const token = () => require('firebase-tools/lib/apiv2').getAccessToken();
async function get(url, body) {
  const response = await fetch(url, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${await token()}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  assert.ok(response.ok, `Operator metadata request failed: HTTP ${response.status}.`);
  return response.json();
}
const project = await get(`https://cloudresourcemanager.googleapis.com/v3/projects/${policy.projectId}`);
assert.equal(project.projectId, policy.projectId); assert.equal(project.name, 'projects/177615774316');
const principal = await get('https://www.googleapis.com/oauth2/v3/userinfo');
assert.ok(principal.sub && principal.email && principal.email_verified === true, 'Verified existing operator OAuth identity required.');
const operator = { provider: 'google-oauth', subject: principal.sub, email: principal.email, verified: true };
const { initializeApp, deleteApp } = adminRequire('firebase-admin/app');
const app = initializeApp({ projectId: policy.projectId, credential: { async getAccessToken() { return { access_token: await token(), expires_in: 300 }; } } }, 'private-owner-takeover');
// The Admin Firestore wrapper accepts only ADC/certificates. The underlying client
// supports the same existing OAuth session directly; no ADC file or key is created.
const firestoreRequire = createRequire(createRequire(adminRequire.resolve('firebase-admin/firestore')).resolve('@google-cloud/firestore'));
// Match gax's credential interface (v9 plain header object, not v10 Headers).
const { GoogleAuth, OAuth2Client } = createRequire(firestoreRequire.resolve('google-gax'))('google-auth-library');
const oauth = new OAuth2Client();
oauth.refreshHandler = async () => ({ access_token: await token(), expiry_date: Date.now() + 300_000 });
oauth.setCredentials(await oauth.refreshHandler());
const db = new (adminRequire('firebase-admin/firestore').Firestore)({ projectId: policy.projectId, auth: new GoogleAuth({ authClient: oauth, projectId: policy.projectId }) });
try {
  const adminAuth = adminRequire('firebase-admin/auth').getAuth(app);
  const fields = 'users(localId,email,emailVerified,disabled,providerUserInfo(providerId),passwordUpdatedAt,validSince,customAuth,emailLinkSignin,phoneNumber,tenantId)';
  const auth = {
    async lookup() {
      const results = await get(`https://identitytoolkit.googleapis.com/v1/projects/${policy.projectId}/accounts:lookup?fields=${fields}`, { email: [approval.targetEmail] });
      assert.equal(results.users?.length, 1, 'Exactly one email match required.');
      const u = results.users[0];
      return { uid: u.localId, email: u.email, emailVerified: u.emailVerified === true, disabled: u.disabled === true,
        providers: (u.providerUserInfo ?? []).map(p => p.providerId), passwordUpdatedAt: Number(u.passwordUpdatedAt), validSince: Number(u.validSince),
        customAuth: u.customAuth === true, emailLinkSignin: u.emailLinkSignin === true, phoneLinked: Boolean(u.phoneNumber), tenantId: u.tenantId ?? null };
    },
    revoke: uid => { assert.equal(uid, approval.targetUid); return adminAuth.revokeRefreshTokens(uid); },
  };
  const result = await takeover({ approval, policy, retirement, operator, auth, store: firestoreTakeoverStore(db, approval.targetUid),
    apply: options['--apply'] === true, confirmPlanSha256: options['--confirm-plan-sha256'] });
  // Contains only reviewable access metadata, never credentials. Keep stdout private.
  console.log(JSON.stringify(result, null, 2));
} finally { await db.terminate(); await deleteApp(app); }
