import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/quizModel.test.ts', 'tools/migration-v1/test/**/*.test.ts'],
  },
});
