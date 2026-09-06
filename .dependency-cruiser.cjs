/* eslint-disable */
/**
 * QUEST dependency rules — enforced in CI via `pnpm deps:check`.
 * Canonical explanation: docs/architecture/DEPENDENCY_RULES.md
 */
const AI_PROVIDER_SDKS = '^(@anthropic-ai/sdk|openai|@google/generative-ai|cohere-ai)';

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'Circular dependencies make modules impossible to reason about or extract.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'packages-must-not-import-apps',
      severity: 'error',
      comment: 'Shared packages are leaves; they never depend on an application.',
      from: { path: '^packages/' },
      to: { path: '^apps/' },
    },
    {
      name: 'apps-must-not-import-other-apps',
      severity: 'error',
      comment: 'Applications share code only through packages/*.',
      from: { path: '^apps/([^/]+)/' },
      to: { path: '^apps/', pathNot: '^apps/$1/' },
    },
    {
      name: 'api-domain-modules-are-isolated',
      severity: 'error',
      comment:
        'A domain module may import from another domain module ONLY via its public index (apps/api/src/modules/<name>/index.ts). Internal files (application/, domain/, infrastructure/, persistence/) are private.',
      from: { path: '^apps/api/src/modules/([^/]+)/' },
      to: {
        path: '^apps/api/src/modules/([^/]+)/(?!index\\.ts$).+',
        pathNot: '^apps/api/src/modules/$1/',
      },
    },
    {
      name: 'api-modules-must-not-import-app-root',
      severity: 'error',
      comment: 'Modules must not depend on the composition root (app.module / main).',
      from: { path: '^apps/api/src/modules/' },
      to: { path: '^apps/api/src/(app\\.module|main)\\.ts$' },
    },
    {
      name: 'api-common-must-not-import-modules',
      severity: 'error',
      comment:
        'Cross-cutting code (common/, infrastructure/, config/) must not know about domain modules.',
      from: { path: '^apps/api/src/(common|infrastructure|config|telemetry)/' },
      to: { path: '^apps/api/src/modules/' },
    },
    {
      name: 'ai-providers-only-in-packages-ai',
      severity: 'error',
      comment:
        'AI provider SDKs are wrapped by the AI Gateway (packages/ai). CLAUDE.md rule 5 / ADR-004.',
      from: { pathNot: '^packages/ai/' },
      to: { path: AI_PROVIDER_SDKS },
    },
    {
      name: 'domain-modules-must-not-import-storage-sdk',
      severity: 'error',
      comment: 'Domain modules use the ObjectStoragePort, never the S3/MinIO SDK directly.',
      from: { path: '^apps/api/src/modules/' },
      to: { path: '^@aws-sdk/' },
    },
    {
      name: 'domain-modules-must-not-import-redis-client',
      severity: 'error',
      comment: 'Domain modules use the RedisPort / cache abstractions, never ioredis directly.',
      from: { path: '^apps/api/src/modules/' },
      to: { path: '^ioredis' },
    },
    {
      name: 'no-orphans',
      severity: 'warn',
      from: {
        orphan: true,
        pathNot: [
          '\\.d\\.ts$',
          '(^|/)tsconfig\\.json$',
          '(^|/)(babel|webpack|vitest|drizzle|next|metro)\\.config\\.(js|cjs|mjs|ts)$',
          '(^|/)index\\.ts$',
          // Framework-convention entry points (imported by Next.js / expo-router, not by our code):
          '^apps/(web|admin)/src/app/',
          '^apps/mobile/app/',
          '(^|/)app\\.config\\.ts$',
          // Declared architecture placeholders with no consumer until a later phase:
          '^apps/mobile/src/lib/permissions\\.ts$',
        ],
      },
      to: {},
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: {
      path: [
        'node_modules',
        '\\.d\\.ts$',
        'dist',
        '\\.next',
        '\\.expo',
        'coverage',
        '\\.test\\.ts$',
        '\\.spec\\.ts$',
        '/test/',
      ],
    },
    tsPreCompilationDeps: true,
    // Also resolves the mobile `@/` alias (apps/mobile/tsconfig.json paths) via the base config.
    tsConfig: { fileName: 'tsconfig.base.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      mainFields: ['module', 'main', 'types'],
    },
    reporterOptions: { text: { highlightFocused: true } },
  },
};
