import node from '@quorum/config/eslint/node.mjs';

/**
 * The integration harness is a console program: its output *is* the deliverable, so the
 * no-console rule that protects the services would only be worked around here.
 */
export default [
  ...node,
  {
    files: ['src/**/*.ts'],
    rules: { 'no-console': 'off' },
  },
];
