import { defineConfig } from '@playwright/test';
import core from './editor-core-workflow.config';

export default defineConfig({
  ...core,
  testMatch: 'editor-staging-compat.spec.ts',
  webServer: {
    cwd: process.cwd(),
    command: 'node apps/web/node_modules/vite/bin/vite.js preview --outDir .local-data/editor-compatibility/baseline-dist --host 127.0.0.1 --port 5201 --strictPort',
    url: 'http://127.0.0.1:5201',
    reuseExistingServer: false,
  },
});
