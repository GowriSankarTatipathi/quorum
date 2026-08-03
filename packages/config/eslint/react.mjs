import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import base from './base.mjs';

export default [
  ...base,
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
];
