import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tools/event-night/candidate-manifest.test.ts'],
    reporters: ['verbose'],
  },
});
