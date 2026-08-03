import next from '@next/eslint-plugin-next';
import react from './react.mjs';

/**
 * Next-specific rules on top of the React preset. These catch the mistakes that are
 * invisible in review but expensive in production — a raw <img> that skips image
 * optimisation, a synchronous script that blocks hydration, a page-level import of a
 * document-only API.
 */
export default [
  ...react,
  {
    plugins: { '@next/next': next },
    rules: {
      ...next.configs.recommended.rules,
      ...next.configs['core-web-vitals'].rules,
    },
  },
];
