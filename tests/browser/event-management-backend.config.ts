import { defineConfig } from '@playwright/test';
if(process.env.EVENT_QA_STAGING !== 'filmovy-kviz-v2-staging' || process.env.EVENT_QA_ORIGIN !== 'http://127.0.0.1:5199') throw Error('Explicit staging candidate verification required');
export default defineConfig({ testDir: '.', testMatch: 'event-management.spec.mjs', workers: 1, timeout: 420000, expect: { timeout: 45000 }, reporter: [['line']],
  outputDir: '../../.local-data/event-management/candidate-browser', use: { actionTimeout: 45000, trace: 'off' },
  webServer: { cwd: process.cwd(), command: 'node tools/event-management/preview-candidate.mjs', url: 'http://127.0.0.1:5199', reuseExistingServer: false } });
