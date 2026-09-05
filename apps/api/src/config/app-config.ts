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
export const appConfigSchema = z
  .object({
    NODE_ENV: nodeEnvSchema.default('development'),
    LOG_LEVEL: logLevelSchema.default('info'),
    API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    API_HOST: z.string().default('0.0.0.0'),
    CORS_ALLOWED_ORIGINS: csvListSchema,
    RATE_LIMIT_TTL_SECONDS: z.coerce.number().int().positive().default(60),
    RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(120),

    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
    DATABASE_SSL: booleanStringSchema.default(false),

    REDIS_URL: z.url({ protocol: /^rediss?$/ }),

    S3_ENDPOINT: z.url().optional(),
    S3_REGION: z.string().min(1).default('us-east-1'),
    S3_BUCKET: z.string().min(3),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),
    S3_FORCE_PATH_STYLE: booleanStringSchema.default(false),

    AI_PROVIDER: z.enum(['none', 'anthropic']).default('none'),
    AI_MODEL_DEFAULT: z.string().optional(),
    AI_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(20_000),

    OTEL_ENABLED: booleanStringSchema.default(false),
    OTEL_SERVICE_NAME: z.string().default('quest-api'),
    OTEL_EXPORTER_OTLP_ENDPOINT: z.url().optional(),
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
