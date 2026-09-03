import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const config = readFileSync('tools/event-night-audit/config.mjs', 'utf8');
const runner = readFileSync('tools/event-night-audit/run.mjs', 'utf8');
const innerRunner = readFileSync('tools/event-night-audit/run-inside.mjs', 'utf8');
const firebaseConfig = readFileSync('firebase.audit.json', 'utf8');
const gitignore = readFileSync('.gitignore', 'utf8');

describe('background event-night audit safety harness', () => {
  it('pins a unique demo project, loopback endpoints and alternative ports', () => {
    expect(config).toContain("demo-filmovy-kviz-v2-background-audit");
    expect(config).toContain("http://127.0.0.1:5200");
    expect(firebaseConfig).toContain('"port": 8280');
    expect(firebaseConfig).toContain('"websocketPort": 9280');
    expect(firebaseConfig).toContain('"port": 9299');
    expect(firebaseConfig).toContain('"port": 9499');
    expect(firebaseConfig).toContain('"port": 9599');
    expect(firebaseConfig).not.toContain('filmovy-kviz.web.app');
  });

  it('removes credential and non-demo override paths before starting emulators', () => {
    expect(runner).toContain('delete environment.GOOGLE_APPLICATION_CREDENTIALS');
    expect(runner).toContain('delete environment.VITE_FIREBASE_ALLOW_NON_DEMO_PROJECT');
    expect(runner).toContain("'emulators:exec'");
    expect(runner).not.toMatch(/firebase[^\n]*deploy/iu);
  });

  it('keeps private artifacts local and verifies candidate/source immutability', () => {
    expect(gitignore).toContain('.local-data/');
    expect(config).toContain('.local-data/background-event-night-audit');
    expect(innerRunner).toContain('verify-readonly.mjs');
    expect(runner).toContain('sourceHashMatch');
  });
});
