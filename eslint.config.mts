import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import { defineConfig } from 'eslint/config';

export default defineConfig([
  {
    ignores: ['.next/**', 'node_modules/**', 'jest.*.js', 'next.*.ts'],
  },
  {
    files: [
      'lib/**/*.ts',
      'app/**/*.ts',
      '__tests__/*.ts',
      'middleware.ts',
      'instrumentation.ts',
    ],
    plugins: { js },
    extends: ['js/recommended'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },
  tseslint.configs.recommended,
]);
