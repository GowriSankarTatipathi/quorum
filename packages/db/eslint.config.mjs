import node from '@quorum/config/eslint/node.mjs';

/**
 * `@prisma/client` is generated at build time (`prisma generate`). Before generation
 * its exported types degrade to `any`, so the type-aware `no-unsafe-*` rules fire on
 * correct code purely as a function of build order. They are disabled for this one
 * package — the surface is a dozen lines of client construction, and every consumer
 * of `@quorum/db` still gets the full generated types with the rules enabled.
 */
export default [
  ...node,
  {
    files: ['src/**/*.ts', 'prisma/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
    },
  },
];
