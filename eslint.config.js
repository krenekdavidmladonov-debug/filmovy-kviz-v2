import eslint from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/lib/**', '**/node_modules/**'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    files: ['**/*.{js,mjs,cjs}'],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: {
      globals: globals.browser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['functions/**/*.ts'],
    languageOptions: {
      globals: globals.node,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['tools/migration-v1/src/**/*.ts'],
    languageOptions: {
      globals: globals.node,
      parserOptions: {
        project: './tools/migration-v1/tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['tests/**/*.{ts,tsx}', 'tools/migration-v1/test/**/*.ts', 'playwright.config.ts', 'vitest.config.ts', 'vitest.rules.config.ts'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
      parserOptions: {
        project: './tsconfig.tests.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['tools/**/*.mjs'],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ['tests/**/*.tsx'],
    rules: {
      '@typescript-eslint/require-await': 'off',
    },
  },
);
