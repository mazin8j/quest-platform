import 'reflect-metadata';

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
