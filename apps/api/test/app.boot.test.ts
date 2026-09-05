import type { INestApplication } from '@nestjs/common';
import {
  apiErrorEnvelopeSchema,
  isApiErrorEnvelope,
  livenessResponseSchema,
  readinessResponseSchema,
} from '@quest/types';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestApp } from './helpers/create-test-app';

describe('API boot & foundation contracts', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(async () => {
    await app.close();
  });

  const server = () => app.getHttpServer() as Parameters<typeof request>[0];

  it('boots the composition root and serves liveness without touching dependencies', async () => {
    const res = await request(server()).get('/health').expect(200);
    const parsed = livenessResponseSchema.safeParse(res.body);
    expect(parsed.success).toBe(true);
    expect(res.body).toMatchObject({ status: 'ok', service: 'quest-api' });
  });

  it('reports readiness with per-dependency checks when everything is up', async () => {
    const res = await request(server()).get('/ready').expect(200);
    const parsed = readinessResponseSchema.parse(res.body);
    expect(parsed.status).toBe('ok');
    expect(parsed.checks.postgres?.status).toBe('up');
    expect(parsed.checks.redis?.status).toBe('up');
    expect(parsed.checks.objectStorage?.status).toBe('up');
  });

  it('serves the first versioned route under /v1 and never leaks secrets', async () => {
    const res = await request(server()).get('/v1/system/info').expect(200);
    expect(res.body).toMatchObject({ service: 'quest-api', apiVersion: 'v1', environment: 'test' });
    expect(JSON.stringify(res.body)).not.toMatch(/postgres|redis|secret|key/i);
  });

  it('applies security headers and hides the framework fingerprint', async () => {
    const res = await request(server()).get('/health').expect(200);
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBeDefined();
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
  });

  it('generates request/correlation ids and echoes a well-formed client correlation id', async () => {
    const generated = await request(server()).get('/health').expect(200);
    expect(generated.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(generated.headers['x-correlation-id']).toBe(generated.headers['x-request-id']);

    const supplied = await request(server())
      .get('/health')
      .set('x-correlation-id', 'journey-abc-12345')
      .expect(200);
    expect(supplied.headers['x-correlation-id']).toBe('journey-abc-12345');

    const unsafe = await request(server())
      .get('/health')
      .set('x-correlation-id', '<img src=x>')
      .expect(200);
    expect(unsafe.headers['x-correlation-id']).not.toContain('<');
  });

  it('renders unknown routes as the standard error envelope with the correlation id', async () => {
    const res = await request(server())
      .get('/v1/does-not-exist')
      .set('x-correlation-id', 'journey-missing-1')
      .expect(404);
    expect(isApiErrorEnvelope(res.body)).toBe(true);
    expect(apiErrorEnvelopeSchema.parse(res.body).error.code).toBe('NOT_FOUND');
    expect(apiErrorEnvelopeSchema.parse(res.body).error.correlationId).toBe('journey-missing-1');
    expect(apiErrorEnvelopeSchema.parse(res.body).error).not.toHaveProperty('stack');
  });

  it('honours CORS only for configured origins', async () => {
    const allowed = await request(server())
      .options('/health')
      .set('Origin', 'http://localhost:3000')
      .set('Access-Control-Request-Method', 'GET');
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    const denied = await request(server()).get('/health').set('Origin', 'https://evil.example');
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('rejects oversized JSON bodies with the envelope (media never transits the API)', async () => {
    const res = await request(server())
      .post('/v1/system/info')
      .set('content-type', 'application/json')
      .send({ blob: 'x'.repeat(300 * 1024) });
    expect([404, 413]).toContain(res.status);
    expect(isApiErrorEnvelope(res.body)).toBe(true);
  });
});

describe('readiness degrades and fails honestly', () => {
  it('returns 503 with the failing dependency named when PostgreSQL is down', async () => {
    const app = await createTestApp({ postgresUp: false, redisUp: true, storageUp: true });
    try {
      const res = await request(app.getHttpServer() as Parameters<typeof request>[0])
        .get('/ready')
        .expect(503);
      const parsed = readinessResponseSchema.parse(res.body);
      expect(parsed.status).toBe('error');
      expect(parsed.checks.postgres?.status).toBe('down');
      expect(parsed.checks.postgres?.detail).not.toMatch(/password|quest:quest/);
    } finally {
      await app.close();
    }
  });

  it('returns 200 degraded when only object storage is unreachable', async () => {
    const app = await createTestApp({ postgresUp: true, redisUp: true, storageUp: false });
    try {
      const res = await request(app.getHttpServer() as Parameters<typeof request>[0])
        .get('/ready')
        .expect(200);
      expect(readinessResponseSchema.parse(res.body).status).toBe('degraded');
    } finally {
      await app.close();
    }
  });
});
