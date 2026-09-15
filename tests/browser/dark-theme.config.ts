import { defineConfig } from '@playwright/test';
import complete from './complete-editor.config';
export default defineConfig(complete, {
  testMatch: 'dark-theme.spec.mjs',
  outputDir: '../../.local-data/dark-mode/browser-test',
  use: { colorScheme: 'light', video: 'off' },
});
