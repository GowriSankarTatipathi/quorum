import node from '@quorum/config/eslint/node.mjs';

/** Root config — individual apps/packages extend the preset that matches them. */
export default [{ ignores: ['apps/**', 'packages/**', 'node_modules/**', '.turbo/**'] }, ...node];
