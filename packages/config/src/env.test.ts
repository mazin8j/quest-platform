import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  EnvValidationError,
  booleanStringSchema,
  csvListSchema,
  parseEnv,
  redactSecrets,
} from './env';

describe('parseEnv', () => {
  const schema = z.object({
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    DATABASE_URL: z.url(),
    DEBUG: booleanStringSchema.default(false),
  });

  it('parses and coerces a valid environment', () => {
    const cfg = parseEnv(schema, {
      DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
      DEBUG: 'yes',
    });
    expect(cfg).toEqual({
      PORT: 4000,
      DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
      DEBUG: true,
    });
  });

  it('throws a redacted, path-annotated error listing every problem', () => {
    expect(() => parseEnv(schema, { PORT: '99999', DEBUG: 'maybe' })).toThrow(EnvValidationError);
    try {
      parseEnv(schema, { PORT: '99999', DEBUG: 'maybe', DATABASE_URL: 'nope' });
    } catch (e) {
      const err = e as EnvValidationError;
      const paths = err.issues.map((i) => i.path).sort();
      expect(paths).toEqual(['DATABASE_URL', 'DEBUG', 'PORT']);
      expect(err.message).not.toContain('99999');
      expect(err.message).toContain('PORT');
    }
  });
});

describe('booleanStringSchema / csvListSchema', () => {
  it('accepts common truthy/falsy spellings', () => {
    for (const t of ['true', 'TRUE', '1', 'yes', 'on'])
      expect(booleanStringSchema.parse(t)).toBe(true);
    for (const f of ['false', '0', 'no', 'off', ''])
      expect(booleanStringSchema.parse(f)).toBe(false);
    expect(booleanStringSchema.safeParse('sometimes').success).toBe(false);
  });

  it('splits and trims comma-separated lists, dropping empties', () => {
    expect(csvListSchema.parse(' a, b ,,c')).toEqual(['a', 'b', 'c']);
    expect(csvListSchema.parse('')).toEqual([]);
    expect(csvListSchema.parse(undefined)).toEqual([]);
  });
});

describe('redactSecrets', () => {
  it('masks secret-looking keys and URL-embedded passwords, leaves the rest', () => {
    const out = redactSecrets({
      API_PORT: 4000,
      S3_SECRET_ACCESS_KEY: 'shh',
      ANTHROPIC_API_KEY: '',
      DATABASE_URL: 'postgresql://quest:hunter2@localhost:5432/quest',
      nested: { jwtSecret: 'x', name: 'ok' },
    });
    expect(out.API_PORT).toBe(4000);
    expect(out.S3_SECRET_ACCESS_KEY).toBe('[redacted]');
    expect(out.ANTHROPIC_API_KEY).toBe('');
    expect(out.DATABASE_URL).toBe('postgresql://quest:[redacted]@localhost:5432/quest');
    expect(out.nested).toEqual({ jwtSecret: '[redacted]', name: 'ok' });
    expect(JSON.stringify(out)).not.toContain('hunter2');
  });
});
