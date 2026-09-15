import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { environment: 'node', fileParallelism: false, include: ['tests/access/rules.test.ts'], hookTimeout: 30000, testTimeout: 15000 } });
