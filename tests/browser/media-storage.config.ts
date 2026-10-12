import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.', testMatch: ['media-storage.spec.mjs', 'media-authoring.spec.mjs'], workers: 1, timeout: 180_000, expect: { timeout: 15_000 },
  reporter: [['line']], preserveOutput: 'failures-only',
  use: { actionTimeout: 20000, navigationTimeout: 20000, baseURL: 'http://127.0.0.1:5198', trace: 'off', screenshot: 'off', video: 'off',
    launchOptions: process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {} },
  outputDir: '../../.local-data/media-storage/browser-results',
  webServer: { cwd: process.cwd(), command: 'node apps/web/node_modules/vite/bin/vite.js apps/web --host 127.0.0.1 --port 5198 --strictPort',
    url: 'http://127.0.0.1:5198', reuseExistingServer: false,
    env: { VITE_FIREBASE_API_KEY: 'demo-api-key', VITE_FIREBASE_AUTH_DOMAIN: 'demo-filmovy-kviz-v2.firebaseapp.com', VITE_FIREBASE_PROJECT_ID: 'demo-filmovy-kviz-v2', VITE_FIREBASE_USE_EMULATORS: 'true', VITE_FIREBASE_STORAGE_BUCKET: 'demo-filmovy-kviz-v2.appspot.com', VITE_FIREBASE_MESSAGING_SENDER_ID: '000000000000', VITE_FIREBASE_APP_ID: '1:000000000000:web:demo' } },
});
