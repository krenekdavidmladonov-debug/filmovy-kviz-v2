import { defineConfig } from '@playwright/test';
import base from './editor-core-workflow.config';
export default defineConfig({ ...base, testMatch: 'editor-save-all.spec.mjs', outputDir: '../../.local-data/editor-save-all/browser-results' });
