import {
  booleanStringSchema,
  csvListSchema,
  logLevelSchema,
  nodeEnvSchema,
  parseEnv,
} from '@quest/config';
import { z } from 'zod';

/**
 * Single source of truth for API configuration. Every variable is validated at boot; the process
 * refuses to start on an invalid environment (fail-fast). Secrets are read here and nowhere else.
 * Documented in .env.example and docs/security/SECURITY_ARCHITECTURE.md.
 */
/**
 * Empty environment values ("VAR=") are treated as unset for optional variables — `.env.example`
 * ships several placeholders that way, and since the CLI loader applies that file they must parse
 * as "not configured" rather than as an invalid value.
 */
const optional = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((v) => (v === '' ? undefined : v), schema.optional());

export const appConfigSchema = z
  .object({
    NODE_ENV: nodeEnvSchema.default('development'),
    LOG_LEVEL: logLevelSchema.default('info'),
    API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    API_HOST: z.string().default('0.0.0.0'),
    CORS_ALLOWED_ORIGINS: csvListSchema,
    RATE_LIMIT_TTL_SECONDS: z.coerce.number().int().positive().default(60),
    RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(120),
    /**
     * Number of trusted reverse-proxy hops in front of the API (Express `trust proxy`). Every
     * rate limit is keyed on the resulting client IP, so this must equal the real topology:
     * 0 when the API is exposed directly, 1 behind a single load balancer, 2 behind
     * CloudFront → ALB (the AWS deployment — audit P01-09). Too low keys the limits on the
     * proxy's own address (one shared bucket per edge location); too high trusts a
     * client-supplied `X-Forwarded-For` entry.
     */
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(1),

    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
    DATABASE_SSL: booleanStringSchema.default(false),

    REDIS_URL: z.url({ protocol: /^rediss?$/ }),

    S3_ENDPOINT: optional(z.url()),
    S3_REGION: z.string().min(1).default('us-east-1'),
    S3_BUCKET: z.string().min(3),
    S3_ACCESS_KEY_ID: optional(z.string()),
    S3_SECRET_ACCESS_KEY: optional(z.string()),
    S3_FORCE_PATH_STYLE: booleanStringSchema.default(false),

    AI_PROVIDER: z.enum(['none', 'anthropic']).default('none'),
    AI_MODEL_DEFAULT: optional(z.string()),
    AI_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(20_000),

    OTEL_ENABLED: booleanStringSchema.default(false),
    OTEL_SERVICE_NAME: z.string().default('quest-api'),
    OTEL_EXPORTER_OTLP_ENDPOINT: optional(z.url()),

    // ---- Identity (Phase 01, ADR-011) ----
    /** HMAC key for access tokens (>= 32 chars). Rotate by moving the old value to _PREVIOUS. */
    AUTH_JWT_SECRET: z.string().min(32),
    AUTH_JWT_SECRET_PREVIOUS: optional(z.string().min(32)),
    AUTH_JWT_ISSUER: z.string().min(1).default('quest-api'),
    AUTH_JWT_AUDIENCE: z.string().min(1).default('quest-clients'),
    AUTH_ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
    AUTH_REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
    AUTH_SESSION_ABSOLUTE_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(90),
    AUTH_MAX_SESSIONS_PER_ACCOUNT: z.coerce.number().int().min(1).max(100).default(20),
    AUTH_LOGIN_MAX_FAILURES: z.coerce.number().int().min(3).max(50).default(10),
    AUTH_LOGIN_LOCK_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),
    AUTH_VERIFICATION_CODE_TTL_MINUTES: z.coerce.number().int().min(1).max(60).default(15),
    AUTH_VERIFICATION_MAX_ATTEMPTS: z.coerce.number().int().min(3).max(20).default(5),
    AUTH_VERIFICATION_RESEND_COOLDOWN_SECONDS: z.coerce
      .number()
      .int()
      .min(10)
      .max(3600)
      .default(60),
    /** Versions users must have accepted; bumping them re-prompts at next sign-in. */
    AUTH_TERMS_VERSION: z
      .string()
      .regex(/^[0-9]{4}-[0-9]{2}(\.[0-9]+)?$/)
      .default('2026-09'),
    AUTH_PRIVACY_POLICY_VERSION: z
      .string()
      .regex(/^[0-9]{4}-[0-9]{2}(\.[0-9]+)?$/)
      .default('2026-09'),
    /** Local/dev/test identity provider adapter (never in production). */
    AUTH_FAKE_PROVIDER_ENABLED: booleanStringSchema.default(false),
    AUTH_APPLE_CLIENT_ID: optional(z.string().min(1)),
    AUTH_GOOGLE_CLIENT_ID: optional(z.string().min(1)),
    /** Mail delivery: `log` prints redacted delivery lines; `memory` keeps an outbox for tests. */
    MAIL_PROVIDER: z.enum(['log', 'memory']).default('log'),
    /** Development aid: include one-time codes in the log line. Refused in production. */
    AUTH_DEV_EXPOSE_CODES: booleanStringSchema.default(false),
    /** Public base for pre-signed/public avatar URLs; falls back to pre-signed downloads. */
    MEDIA_PUBLIC_BASE_URL: optional(z.url()),
  })
  .superRefine((cfg, ctx) => {
    if (cfg.NODE_ENV === 'production') {
      if (cfg.LOG_LEVEL === 'trace' || cfg.LOG_LEVEL === 'debug') {
        ctx.addIssue({
          code: 'custom',
          path: ['LOG_LEVEL'],
          message: 'debug/trace logging is not allowed in production',
        });
      }
      if (!cfg.DATABASE_SSL) {
        ctx.addIssue({
          code: 'custom',
          path: ['DATABASE_SSL'],
          message: 'must be true in production',
        });
      }
      if (cfg.S3_ENDPOINT && /localhost|127\.0\.0\.1/.test(cfg.S3_ENDPOINT)) {
        ctx.addIssue({
          code: 'custom',
          path: ['S3_ENDPOINT'],
          message: 'local object storage endpoint in production',
        });
      }
      if (cfg.AUTH_FAKE_PROVIDER_ENABLED) {
        ctx.addIssue({
          code: 'custom',
          path: ['AUTH_FAKE_PROVIDER_ENABLED'],
          message: 'the FAKE identity provider must be disabled in production',
        });
      }
      if (cfg.AUTH_DEV_EXPOSE_CODES) {
        ctx.addIssue({
          code: 'custom',
          path: ['AUTH_DEV_EXPOSE_CODES'],
          message: 'one-time codes must never be logged in production',
        });
      }
      if (cfg.MAIL_PROVIDER === 'memory') {
        ctx.addIssue({
          code: 'custom',
          path: ['MAIL_PROVIDER'],
          message: 'the in-memory mailer is for tests only',
        });
      }
      if (cfg.AUTH_JWT_SECRET_PREVIOUS === cfg.AUTH_JWT_SECRET) {
        ctx.addIssue({
          code: 'custom',
          path: ['AUTH_JWT_SECRET_PREVIOUS'],
          message: 'must differ from AUTH_JWT_SECRET',
        });
      }
    }
    if (
      (cfg.S3_ACCESS_KEY_ID && !cfg.S3_SECRET_ACCESS_KEY) ||
      (!cfg.S3_ACCESS_KEY_ID && cfg.S3_SECRET_ACCESS_KEY)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['S3_ACCESS_KEY_ID'],
        message: 'S3 access key id and secret must be set together',
      });
    }
    if (cfg.AI_PROVIDER !== 'none' && !cfg.AI_MODEL_DEFAULT) {
      ctx.addIssue({
        code: 'custom',
        path: ['AI_MODEL_DEFAULT'],
        message: 'required when AI_PROVIDER is configured',
      });
    }
  });

export type AppConfig = z.infer<typeof appConfigSchema>;

export function loadAppConfig(source: Record<string, string | undefined> = process.env): AppConfig {
  return parseEnv(appConfigSchema, source);
}

/** DI token for the validated config object. */
export const APP_CONFIG = Symbol('APP_CONFIG');
