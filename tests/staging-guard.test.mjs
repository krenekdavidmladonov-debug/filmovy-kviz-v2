import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertStagingEnvironment, assertStagingProject, STAGING_PROJECT, STAGING_APP } from '../tools/staging/guard.mjs';

const valid = { VITE_FIREBASE_PROJECT_ID: STAGING_PROJECT, VITE_APP_ENV: 'staging',
  VITE_FIREBASE_AUTH_DOMAIN: `${STAGING_PROJECT}.firebaseapp.com`, VITE_FIREBASE_APP_ID: STAGING_APP,
  VITE_FIREBASE_STORAGE_BUCKET: `${STAGING_PROJECT}.firebasestorage.app`,
  VITE_FIREBASE_MESSAGING_SENDER_ID: '177615774316', VITE_FIREBASE_API_KEY: 'synthetic-key',
  VITE_FIREBASE_USE_EMULATORS: 'false', VITE_FIREBASE_ALLOW_NON_DEMO_PROJECT: 'true' };
test('only the exact staging target is accepted', () => {
  assert.equal(assertStagingProject(STAGING_PROJECT), STAGING_PROJECT);
  for (const project of [undefined, '', 'filmovy-kviz', 'demo-filmovy-kviz-v2', 'another-project']) {
    assert.throws(() => assertStagingProject(project));
  }
});
test('mixed, missing, production, and emulator staging configurations fail closed', () => {
  assert.doesNotThrow(() => assertStagingEnvironment(valid));
  for (const key of Object.keys(valid)) {
    assert.throws(() => assertStagingEnvironment({ ...valid, [key]: '' }));
  }
  assert.throws(() => assertStagingEnvironment({ ...valid, VITE_FIREBASE_PROJECT_ID: 'filmovy-kviz' }));
  assert.throws(() => assertStagingEnvironment({ ...valid, VITE_FIREBASE_USE_EMULATORS: 'true' }));
});
