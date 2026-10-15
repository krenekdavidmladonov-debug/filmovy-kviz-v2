import { defineConfig } from '@playwright/test';
import base from './whole-evening-performance.config';

export default defineConfig({
  ...base,
  testMatch: 'show-mode-baseline.spec.mjs',
  timeout: 600000,
  outputDir: '../../.local-data/show-mode-baseline/browser-results',
  webServer: [...(Array.isArray(base.webServer) ? base.webServer : base.webServer ? [base.webServer] : []), {
    cwd: process.cwd(), command: 'node tools/qa/show-mode-baseline.mjs --serve',
    url: 'http://127.0.0.1:5209', reuseExistingServer: false, timeout: 120000,
  }],
});
