import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

import base from '../../eslint.config.mjs';

export default [
  ...base,
  ...nextVitals,
  ...nextTs,
  {
    ignores: ['.next/**', 'next-env.d.ts'],
  },
];
