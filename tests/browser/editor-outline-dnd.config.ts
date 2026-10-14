import { defineConfig } from '@playwright/test';
import base from './editor-core-workflow.config';
export default defineConfig({ ...base, testMatch: ['editor-save-all.spec.mjs', 'editor-outline-dnd.spec.mjs'], outputDir: '../../.local-data/editor-outline-dnd/browser-results' });
