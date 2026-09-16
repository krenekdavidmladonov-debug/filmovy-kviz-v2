import { defineConfig } from '@playwright/test';
if (process.env.EVENT_QA_STAGING !== 'filmovy-kviz-v2-staging') throw new Error('Explicit fixed staging QA required.');
export default defineConfig({ testDir: '.', testMatch: 'event-management.spec.mjs', workers: 1, timeout: 360000, expect: { timeout: 45000 }, reporter: [['line']],
  outputDir: '../../.local-data/event-management/online-browser', use: { baseURL: 'https://filmovy-kviz-v2-staging.web.app', viewport: { width: 1366, height: 900 }, actionTimeout: 45000, trace: 'off' } });
