import assert from 'node:assert/strict';
import { legacyStagingAccounts } from '../access/legacy-staging-accounts.mjs';
import { STAGING_PROJECT } from './guard.mjs';

export function assertIsolatedQaManifest(manifest) {
  assert.equal(manifest.project, STAGING_PROJECT, 'Only staging QA is supported.');
  assert.match(manifest.qaRunId ?? '', /^staging-qa-[a-z0-9-]{12,80}$/u, 'Legacy seed logins are retired. Supply an isolated run-owned QA manifest.');
  assert.ok(manifest.users && Object.keys(manifest.users).length, 'Explicit QA identities required.');
  for (const user of Object.values(manifest.users)) {
    assert.ok(user.uid && !Object.values(legacyStagingAccounts).includes(user.uid), 'Legacy personal/shared identities cannot be used by QA.');
    assert.ok(user.uid.startsWith(`${manifest.qaRunId}-`) && user.email === `${user.uid}@example.test`
      && !user.retired && typeof user.password === 'string' && user.password.length >= 12, 'Only isolated synthetic QA credentials are allowed.');
  }
}
