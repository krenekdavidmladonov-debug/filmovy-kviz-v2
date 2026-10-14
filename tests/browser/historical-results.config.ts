import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '.', testMatch: 'historical-results.spec.mjs', workers: 1, timeout: 180000, expect: { timeout: 20000 },
  use: { baseURL: 'http://127.0.0.1:5207', trace: 'off', screenshot: 'off', video: 'off',
    launchOptions: process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {} },
  outputDir: '../../.local-data/historical-results/browser-results',
  webServer: { cwd: process.cwd(), command: 'node apps/web/node_modules/vite/bin/vite.js apps/web --host 127.0.0.1 --port 5207 --strictPort',
    url: 'http://127.0.0.1:5207', reuseExistingServer: false,
    env: { VITE_FIREBASE_API_KEY: 'demo-api-key', VITE_FIREBASE_AUTH_DOMAIN: 'demo-filmovy-kviz-v2.firebaseapp.com', VITE_FIREBASE_PROJECT_ID: 'demo-filmovy-kviz-v2',
      VITE_FIREBASE_USE_EMULATORS: 'true', VITE_FIREBASE_STORAGE_BUCKET: 'demo-filmovy-kviz-v2.appspot.com', VITE_FIREBASE_MESSAGING_SENDER_ID: '000000000000', VITE_FIREBASE_APP_ID: '1:000000000000:web:demo' } },
});
