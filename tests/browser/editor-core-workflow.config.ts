import { defineConfig } from '@playwright/test';

const baseURL = 'http://127.0.0.1:5201';
const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH;

export default defineConfig({
  testDir: '.',
  testMatch: 'editor-core-workflow.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 180_000,
  expect: { timeout: 15_000 },
  reporter: [['line']],
  preserveOutput: 'failures-only',
  outputDir: '../../.local-data/editor-core-workflow/browser-results',
  use: {
    baseURL,
    actionTimeout: 20_000,
    navigationTimeout: 20_000,
    trace: 'off',
    screenshot: 'off',
    video: 'off',
    launchOptions: executablePath ? { executablePath } : {},
  },
  webServer: {
    cwd: process.cwd(),
    command: 'node apps/web/node_modules/vite/bin/vite.js apps/web --host 127.0.0.1 --port 5201 --strictPort',
    url: baseURL,
    reuseExistingServer: false,
    env: {
      VITE_FIREBASE_API_KEY: 'demo-api-key',
      VITE_FIREBASE_AUTH_DOMAIN: 'demo-filmovy-kviz-v2.firebaseapp.com',
      VITE_FIREBASE_PROJECT_ID: 'demo-filmovy-kviz-v2',
      VITE_FIREBASE_USE_EMULATORS: 'true',
      VITE_FIREBASE_STORAGE_BUCKET: 'demo-filmovy-kviz-v2.appspot.com',
      VITE_FIREBASE_MESSAGING_SENDER_ID: '000000000000',
      VITE_FIREBASE_APP_ID: '1:000000000000:web:demo',
    },
  },
});
