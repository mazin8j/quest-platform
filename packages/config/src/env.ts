import { z } from 'zod';

export const nodeEnvSchema = z.enum(['development', 'test', 'staging', 'production']);
export type NodeEnv = z.infer<typeof nodeEnvSchema>;

export const logLevelSchema = z.enum([
  'fatal',
  'error',
  'warn',
  'info',
  'debug',
  'trace',
  'silent',
]);
export type LogLevel = z.infer<typeof logLevelSchema>;

/** Accepts "true"/"false"/"1"/"0"/"yes"/"no" (case-insensitive) from environment strings. */
export const booleanStringSchema = z.union([z.boolean(), z.string()]).transform((v, ctx) => {
  if (typeof v === 'boolean') return v;
  const s = v.trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(s)) return true;
  if (['false', '0', 'no', 'off', ''].includes(s)) return false;
  ctx.addIssue({ code: 'custom', message: `Expected a boolean-like string, received "${v}"` });
  return z.NEVER;
});

/** Comma-separated list → trimmed, non-empty string array. */
export const csvListSchema = z
  .string()
  .default('')
  .transform((s) =>
    s
      .split(',')
      .map((x) => x.trim())
      .filter((x) => x.length > 0),
  );

/** Names (or name fragments) whose values must never be logged. */
export const SECRET_KEY_PATTERN =
  /(secret|password|passwd|token|api[_-]?key|private[_-]?key|credential)/i;

export class EnvValidationError extends Error {
  constructor(public readonly issues: ReadonlyArray<{ path: string; message: string }>) {
    super(
      `Invalid environment configuration:\n${issues.map((i) => `  - ${i.path}: ${i.message}`).join('\n')}`,
    );
    this.name = 'EnvValidationError';
  }
}

/**
 * Parse an environment source against a zod schema. Throws EnvValidationError with a redacted,
 * human-readable list of problems (values are never included in the message).
 */
export function parseEnv<S extends z.ZodTypeAny>(
  schema: S,
  source: Record<string, string | undefined> = process.env,
): z.infer<S> {
  const result = schema.safeParse(source);
  if (!result.success) {
    throw new EnvValidationError(
      result.error.issues.map((i) => ({ path: i.path.join('.') || '(root)', message: i.message })),
    );
  }
  return result.data;
}

/** Return a copy of a config object with secret-looking keys replaced by "[redacted]". */
export function redactSecrets<T extends Record<string, unknown>>(
  config: T,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    if (SECRET_KEY_PATTERN.test(key)) {
      out[key] = value === undefined || value === '' ? value : '[redacted]';
    } else if (typeof value === 'string' && /^[a-z][a-z0-9+.-]*:\/\/[^/]*:[^@/]+@/i.test(value)) {
      // URL with embedded credentials (postgres://user:pass@host) → mask the password part.
      out[key] = value.replace(/^([a-z][a-z0-9+.-]*:\/\/[^/:]*:)[^@/]+@/i, '$1[redacted]@');
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      out[key] = redactSecrets(value as Record<string, unknown>);
    } else {
      out[key] = value;
    }
  }
  return out;
}
