import {defineConfig} from '@playwright/test';
import base from './whole-evening-performance.config';
export default defineConfig({...base,testMatch:'whole-evening-design.spec.mjs',outputDir:'../../.local-data/whole-evening/design-browser',timeout:900000});
