import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

/**
 * Shared flat ESLint config for every QUORUM package.
 * Type-aware rules are enabled: the product's core guarantee is data correctness,
 * so rules that need type information (no-floating-promises, no-misused-promises)
 * are exactly the ones worth paying for.
 */
export default tseslint.config(
  { ignores: ['dist/**', '.next/**', '.turbo/**', 'coverage/**', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: process.cwd() },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      'no-console': ['error', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
    },
  },
  {
    files: ['**/*.test.ts', '**/*.test.tsx', '**/*.spec.ts'],
    rules: { '@typescript-eslint/no-non-null-assertion': 'off' },
  },
  prettier,
);
