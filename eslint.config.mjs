// Root ESLint flat config shared by all TypeScript workspaces.
// Next.js apps extend this with `eslint-config-next` in their own eslint.config.mjs.
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/** AI provider SDKs may only be imported from packages/ai (CLAUDE.md rule 5, ADR-004). */
export const AI_PROVIDER_MODULES = [
  '@anthropic-ai/sdk',
  'openai',
  '@google/generative-ai',
  'cohere-ai',
];

export const baseConfig = tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/.next/**',
      '**/.expo/**',
      '**/.turbo/**',
      '**/coverage/**',
      '**/drizzle/meta/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: { ...globals.node, ...globals.es2022 },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: { attributes: false } },
      ],
      '@typescript-eslint/ban-ts-comment': [
        'error',
        { 'ts-expect-error': 'allow-with-description' },
      ],
      'no-console': ['error', { allow: ['warn', 'error'] }],
      'no-restricted-imports': [
        'error',
        {
          paths: AI_PROVIDER_MODULES.map((name) => ({
            name,
            message: 'AI providers must be accessed through @quest/ai (AI Gateway). See ADR-004.',
          })),
        },
      ],
    },
  },
  {
    // Tooling/config files are not type-checked (explicit list: app code is never excluded by accident).
    files: [
      '**/*.{js,mjs,cjs}',
      '**/vitest.config.ts',
      '**/next.config.ts',
      '**/drizzle.config.ts',
      '**/app.config.ts',
    ],
    ...tseslint.configs.disableTypeChecked,
    rules: { ...tseslint.configs.disableTypeChecked.rules, 'no-console': 'off' },
  },
  {
    // Scripts and tests may log.
    files: ['**/src/cli/**/*.ts', '**/*.test.ts', '**/*.spec.ts', '**/test/**/*.ts'],
    rules: { 'no-console': 'off' },
  },
  {
    // HTTP integration suites assert on supertest's untyped `res.body`; the contracts themselves
    // are checked with zod schemas inside those tests, so the unsafe-any family is relaxed here only.
    files: ['**/test/integration/**/*.int.test.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
    },
  },
  prettier,
);

export default baseConfig;
