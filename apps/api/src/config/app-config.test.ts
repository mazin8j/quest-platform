import { EnvValidationError } from '@quest/config';
import { describe, expect, it } from 'vitest';

import { loadAppConfig } from './app-config';

const valid = {
  DATABASE_URL: 'postgresql://quest:quest@localhost:5432/quest',
  REDIS_URL: 'redis://localhost:6379',
  S3_BUCKET: 'quest-media-local',
  AUTH_JWT_SECRET: 'unit-test-only-secret-0123456789abcdef0123456789',
};

describe('API configuration validation', () => {
  it('loads a minimal valid environment with safe defaults', () => {
    const cfg = loadAppConfig(valid);
    expect(cfg.NODE_ENV).toBe('development');
    expect(cfg.API_PORT).toBe(4000);
    expect(cfg.CORS_ALLOWED_ORIGINS).toEqual([]);
    expect(cfg.AI_PROVIDER).toBe('none');
    expect(cfg.OTEL_ENABLED).toBe(false);
    expect(cfg.RATE_LIMIT_MAX_REQUESTS).toBe(120);
  });

  it('parses lists, booleans and numbers from strings', () => {
    const cfg = loadAppConfig({
      ...valid,
      CORS_ALLOWED_ORIGINS: 'http://localhost:3000, http://localhost:3001',
      DATABASE_SSL: 'true',
      API_PORT: '8080',
    });
    expect(cfg.CORS_ALLOWED_ORIGINS).toEqual(['http://localhost:3000', 'http://localhost:3001']);
    expect(cfg.DATABASE_SSL).toBe(true);
    expect(cfg.API_PORT).toBe(8080);
  });

  it('refuses to boot without a database or redis URL', () => {
    expect(() => loadAppConfig({ S3_BUCKET: 'b' })).toThrow(EnvValidationError);
    expect(() => loadAppConfig({ ...valid, DATABASE_URL: 'mysql://x' })).toThrow(/DATABASE_URL/);
    expect(() => loadAppConfig({ ...valid, REDIS_URL: 'http://x' })).toThrow(/REDIS_URL/);
  });

  it('enforces production hardening rules', () => {
    const prod = { ...valid, NODE_ENV: 'production' };
    expect(() => loadAppConfig({ ...prod, DATABASE_SSL: 'false', LOG_LEVEL: 'debug' })).toThrow(
      /DATABASE_SSL[\s\S]*|LOG_LEVEL/,
    );
    expect(() =>
      loadAppConfig({ ...prod, DATABASE_SSL: 'true', S3_ENDPOINT: 'http://localhost:9000' }),
    ).toThrow(/S3_ENDPOINT/);
    expect(loadAppConfig({ ...prod, DATABASE_SSL: 'true', LOG_LEVEL: 'info' }).NODE_ENV).toBe(
      'production',
    );
  });

  it('requires S3 credentials to be set together and a model when AI is enabled', () => {
    expect(() => loadAppConfig({ ...valid, S3_ACCESS_KEY_ID: 'only-id' })).toThrow(
      /S3_ACCESS_KEY_ID/,
    );
    expect(() => loadAppConfig({ ...valid, AI_PROVIDER: 'anthropic' })).toThrow(/AI_MODEL_DEFAULT/);
    expect(
      loadAppConfig({ ...valid, AI_PROVIDER: 'anthropic', AI_MODEL_DEFAULT: 'from-config' })
        .AI_MODEL_DEFAULT,
    ).toBe('from-config');
  });

  it('never leaks values in validation error messages', () => {
    try {
      loadAppConfig({
        ...valid,
        REDIS_URL: 'redis://:supersecretpassword@host:1',
        DATABASE_URL: 'bad',
      });
    } catch (e) {
      expect((e as Error).message).not.toContain('supersecretpassword');
    }
  });

  it('requires an access-token secret and refuses dev-only identity switches in production', () => {
    expect(() => loadAppConfig({ ...valid, AUTH_JWT_SECRET: 'short' })).toThrow(/AUTH_JWT_SECRET/);
    expect(loadAppConfig({ ...valid, AUTH_JWT_SECRET_PREVIOUS: '' }).AUTH_JWT_SECRET_PREVIOUS).toBe(
      undefined,
    );
    const prod = { ...valid, NODE_ENV: 'production', DATABASE_SSL: 'true' };
    expect(() => loadAppConfig({ ...prod, AUTH_FAKE_PROVIDER_ENABLED: 'true' })).toThrow(
      /AUTH_FAKE_PROVIDER_ENABLED/,
    );
    expect(() => loadAppConfig({ ...prod, AUTH_DEV_EXPOSE_CODES: 'true' })).toThrow(
      /AUTH_DEV_EXPOSE_CODES/,
    );
    expect(() => loadAppConfig({ ...prod, MAIL_PROVIDER: 'memory' })).toThrow(/MAIL_PROVIDER/);
    expect(() =>
      loadAppConfig({ ...prod, AUTH_JWT_SECRET_PREVIOUS: valid.AUTH_JWT_SECRET }),
    ).toThrow(/AUTH_JWT_SECRET_PREVIOUS/);
    expect(loadAppConfig(prod).AUTH_ACCESS_TOKEN_TTL_SECONDS).toBe(900);
  });
});
