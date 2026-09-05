import base from '../../eslint.config.mjs';

export default [
  ...base,
  {
    files: ['app/**/*.tsx', 'src/**/*.tsx'],
    rules: {
      // React Native components are arrow functions returning JSX; JSX requires no React import in RN 0.7x+.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_|^React$' },
      ],
    },
  },
  { ignores: ['.expo/**', 'expo-env.d.ts', 'babel.config.js', 'metro.config.js'] },
];
