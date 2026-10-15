import { defineConfig } from '@playwright/test';
import base from './whole-evening-design.config';

export default defineConfig({
  ...base,
  testMatch: ['show-mode.spec.mjs', 'show-audio.spec.mjs'],
  outputDir: '../../.local-data/show-mode/browser-results',
  workers: 1,
  timeout: 900000,
  use: { ...base.use, viewport: { width: 1920, height: 1080 }, video: 'on', trace: 'retain-on-failure' },
});
