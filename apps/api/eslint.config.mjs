import base from '../../eslint.config.mjs';

export default [
  ...base,
  {
    files: ['src/**/*.ts'],
    rules: {
      // NestJS relies on classes used only as DI tokens / decorators.
      '@typescript-eslint/no-extraneous-class': 'off',
    },
  },
];
