import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertStagingEnvironment, assertStagingProject, STAGING_PROJECT, STAGING_APP } from '../tools/staging/guard.mjs';
import { readFileSync } from 'node:fs';
import { deploymentMode, assertHostingOnlyConfig, hostingOnlyArgs, assertFrontendFiles, teamToolFunctionArgs } from '../tools/staging/hosting-only.mjs';

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

const stagingConfig = JSON.parse(readFileSync(new URL('../firebase.staging.json', import.meta.url), 'utf8'));
test('team tooling backend deploy accepts only the two exact callables with no hooks or overrides', () => {
  assert.equal(deploymentMode([STAGING_PROJECT, '--team-tools-functions']), 'team-tools-functions');
  assert.deepEqual(teamToolFunctionArgs(STAGING_PROJECT, valid, stagingConfig, 'functions.json'), ['deploy', '--project', STAGING_PROJECT, '--config', 'functions.json', '--only', 'functions:adminAddEventTeam,functions:adminUpdateEventTeam', '--non-interactive']);
  assert.throws(() => deploymentMode([STAGING_PROJECT, '--team-tools-functions', 'functions:health']));
  assert.throws(() => teamToolFunctionArgs('wrong', valid, stagingConfig, 'x'));
  assert.throws(() => teamToolFunctionArgs(STAGING_PROJECT, { ...valid, VITE_FIREBASE_USE_EMULATORS: 'true' }, stagingConfig, 'x'));
  assert.throws(() => teamToolFunctionArgs(STAGING_PROJECT, valid, { ...stagingConfig, functions: { ...stagingConfig.functions, predeploy: ['seed'] } }, 'x'));
  assert.throws(() => teamToolFunctionArgs(STAGING_PROJECT, valid, { ...stagingConfig, functions: { ...stagingConfig.functions, source: '.' } }, 'x'));
});
test('Hosting-only is fixed to the staging site, frontend and official hosting scope', () => {
  assert.equal(deploymentMode([STAGING_PROJECT, '--hosting-only']), 'hosting-only');
  assert.deepEqual(hostingOnlyArgs(STAGING_PROJECT, valid, stagingConfig, 'generated.json'), [
    'deploy', '--project', STAGING_PROJECT, '--config', 'generated.json', '--only', 'hosting', '--non-interactive',
  ]);
  assert.throws(() => deploymentMode(['filmovy-kviz', '--hosting-only']));
  for (const override of ['functions', 'firestore:rules', 'storage', 'seed', '--force']) {
    assert.throws(() => deploymentMode([STAGING_PROJECT, '--hosting-only', override]));
    assert.throws(() => deploymentMode([STAGING_PROJECT, override]));
  }
  assert.throws(() => hostingOnlyArgs('another-project', valid, stagingConfig, 'generated.json'));
  assert.throws(() => hostingOnlyArgs(STAGING_PROJECT, { ...valid, VITE_FIREBASE_PROJECT_ID: 'another-project' }, stagingConfig, 'generated.json'));
});
test('alternate sites, directories, hooks and backend rewrites fail closed', () => {
  for (const patch of [
    { site: 'another-site' }, { target: 'another-target' }, { public: '.local-data' },
    { predeploy: ['seed'] }, { postdeploy: ['firebase deploy --only functions'] },
    { rewrites: [{ source: '**', function: { functionId: 'test', pinTag: true } }] },
    { rewrites: [{ source: '**', run: { serviceId: 'test' } }] }, { headers: [] },
  ]) assert.throws(() => assertHostingOnlyConfig({ ...stagingConfig, hosting: { ...stagingConfig.hosting, ...patch } }));
  assert.throws(() => assertHostingOnlyConfig({ ...stagingConfig, predeploy: ['seed'] }));
  assert.throws(() => assertHostingOnlyConfig({ ...stagingConfig, functions: { predeploy: ['backend'] } }));
  assert.throws(() => assertHostingOnlyConfig({ ...stagingConfig, hosting: [stagingConfig.hosting] }));
});
test('only generated frontend files without private artifacts can be published', () => {
  const entry = { name: 'index.html', text: '<html></html>' };
  assert.doesNotThrow(() => assertFrontendFiles([entry, { name: 'assets/app.js', text: 'STAGING' }]));
  for (const name of ['.env', '.local-data/seed.json', 'passwords.json', 'assets/export.json', 'assets/app.js.map']) {
    assert.throws(() => assertFrontendFiles([entry, { name, text: '' }]));
  }
  for (const text of ['-----BEGIN PRIVATE KEY-----', '{"private_key":"secret"}', '{"refresh_token":"secret"}', '.local-data/seed.json']) {
    assert.throws(() => assertFrontendFiles([entry, { name: 'assets/app.js', text }]));
  }
});
