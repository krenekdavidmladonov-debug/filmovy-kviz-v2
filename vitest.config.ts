import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'tests/quizModel.test.ts',
      'tests/liveSession.test.ts',
      'tests/liveRepository.test.ts',
      'tests/quizEditor.test.ts',
      'tests/presentation.test.ts',
      'tests/presentationComponents.test.tsx',
      'tests/localEmulatorEnvironment.test.ts',
      'tools/migration-v1/test/**/*.test.ts',
    ],
  },
});
