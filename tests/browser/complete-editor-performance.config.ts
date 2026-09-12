import { defineConfig } from '@playwright/test';
import base from './complete-editor.config';
export default defineConfig({...base,testMatch:'complete-editor-performance.spec.mjs',outputDir:'../../.local-data/complete-editor/performance-browser',use:{...base.use,video:'off'}});
