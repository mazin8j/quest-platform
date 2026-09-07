import 'reflect-metadata';

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Deterministic environment for the integration project.
 *
 * Integration suites talk to real infrastructure but must never inherit the developer's
 * application configuration: a local `.env` with, say, `TRUST_PROXY_HOPS=0` silently changes what
 * the tests measure. So everything except the two infrastructure endpoints is pinned here, and the
 * endpoints themselves must be provided — the unit project's deliberately unreachable fallbacks
 * (`127.0.0.1:65432` / `:65433`) would otherwise turn a missing variable into a confusing
 * `ECONNREFUSED 127.0.0.1:65433` instead of a clear instruction.
 */
/**
 * Workspace packages resolve through their compiled `dist/` (`main`/`exports` in each
 * package.json), so the suites cannot run until the API's workspace dependencies are built. Vite
 * reports that as `Failed to resolve entry for package "@quest/types"` — accurate but hard to act
 * on, and it happens while the test file is being imported, before any assertion runs.
 *
 * The list is derived from `apps/api/package.json`, not hardcoded, so a new workspace dependency
 * is covered automatically. `pnpm test:integration` (and the CI job) go through Turbo, whose
 * `test:integration` task depends on `^build`, so this check should never fire there.
 */
function assertWorkspaceDependenciesBuilt(): void {
  const apiRoot = path.resolve(__dirname, '..');
  const repoRoot = path.resolve(apiRoot, '..', '..');
  const manifest = JSON.parse(readFileSync(path.join(apiRoot, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const workspaceDeps = [
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.devDependencies ?? {}),
  ].filter((name) => name.startsWith('@quest/'));

  const unbuilt = workspaceDeps.filter((name) => {
    // `exports` hides ./package.json from require.resolve, so look the manifest up by path:
    // the workspace link under either node_modules tree, or the source folder itself.
    const candidates = [
      path.join(apiRoot, 'node_modules', name, 'package.json'),
      path.join(repoRoot, 'node_modules', name, 'package.json'),
      path.join(repoRoot, 'packages', name.replace('@quest/', ''), 'package.json'),
    ];
    const manifestPath = candidates.find((candidate) => existsSync(candidate));
    if (!manifestPath) return true; // not installed at all: same remedy, install then build
    const pkg = JSON.parse(readFileSync(manifestPath, 'utf8')) as { main?: string };
    return !existsSync(path.resolve(path.dirname(manifestPath), pkg.main ?? 'dist/index.js'));
  });
  if (unbuilt.length > 0) {
    throw new Error(
      `These workspace packages have not been built, so the integration suites cannot import ` +
        `them: ${unbuilt.join(', ')}.\nRun the suite through Turbo, which builds them first:\n` +
        `  RUN_INTEGRATION=true DATABASE_URL=... REDIS_URL=... pnpm test:integration\n` +
        `(or \`pnpm turbo run build --filter=@quest/api^...\` before ` +
        `\`pnpm --filter @quest/api test:integration\`).`,
    );
  }
}

const required = ['DATABASE_URL', 'REDIS_URL'] as const;
const missing = required.filter((name) => !process.env[name]);
if (process.env.RUN_INTEGRATION === 'true' && missing.length > 0) {
  throw new Error(
    `Integration tests need ${missing.join(' and ')}. Start the local stack with ` +
      `\`pnpm infra:up\` and run:\n` +
      `  RUN_INTEGRATION=true DATABASE_URL=postgresql://<user>:<password>@localhost:5432/quest ` +
      `REDIS_URL=redis://localhost:6379 pnpm --filter @quest/api test:integration\n` +
      `See docs/DEVELOPER_SETUP.md "Integration tests".`,
  );
}

assertWorkspaceDependenciesBuilt();

// Pinned so a suite measures the application, not the machine it runs on.
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
// Per-request client IP comes from one forwarded hop: the suites give each actor its own
// `x-forwarded-for` so per-route throttles stay independent.
process.env.TRUST_PROXY_HOPS = '1';
process.env.MAIL_PROVIDER = 'memory';
process.env.AUTH_FAKE_PROVIDER_ENABLED = 'true';
process.env.AUTH_JWT_SECRET = 'integration-test-only-secret-0123456789abcdef0123456789';
delete process.env.AUTH_JWT_SECRET_PREVIOUS;
process.env.AUTH_TERMS_VERSION = '2026-09';
process.env.AUTH_PRIVACY_POLICY_VERSION = '2026-09';
process.env.CORS_ALLOWED_ORIGINS = 'http://localhost:3000';
process.env.S3_BUCKET = 'quest-test-bucket';
process.env.S3_ENDPOINT = 'http://127.0.0.1:65434'; // object storage is stubbed in-process
process.env.S3_ACCESS_KEY_ID = 'test';
process.env.S3_SECRET_ACCESS_KEY = 'test';
process.env.S3_FORCE_PATH_STYLE = 'true';
process.env.MEDIA_PUBLIC_BASE_URL = 'http://127.0.0.1:65434/quest-test-bucket';
process.env.OTEL_ENABLED = 'false';
delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
delete process.env.AUTH_DEV_EXPOSE_CODES;
