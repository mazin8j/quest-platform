import type { INestApplication } from '@nestjs/common';
import { apiErrorEnvelopeSchema, isApiErrorEnvelope } from '@quest/types';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestApp } from './helpers/create-test-app';

describe('rate-limit architecture (global throttler)', () => {
  let app: INestApplication;
  const previous = {
    ttl: process.env.RATE_LIMIT_TTL_SECONDS,
    max: process.env.RATE_LIMIT_MAX_REQUESTS,
  };

  beforeAll(async () => {
    process.env.RATE_LIMIT_TTL_SECONDS = '60';
    process.env.RATE_LIMIT_MAX_REQUESTS = '3';
    app = await createTestApp();
  });
  afterAll(async () => {
    await app.close();
    process.env.RATE_LIMIT_TTL_SECONDS = previous.ttl;
    process.env.RATE_LIMIT_MAX_REQUESTS = previous.max;
  });

  it('returns 429 RATE_LIMITED with the envelope once the window budget is exhausted', async () => {
    const server = app.getHttpServer() as Parameters<typeof request>[0];
    for (let i = 0; i < 3; i++) await request(server).get('/v1/system/info').expect(200);
    const limited = await request(server).get('/v1/system/info').expect(429);
    expect(isApiErrorEnvelope(limited.body)).toBe(true);
    expect(apiErrorEnvelopeSchema.parse(limited.body).error.code).toBe('RATE_LIMITED');
  });

  it('never throttles health probes', async () => {
    const server = app.getHttpServer() as Parameters<typeof request>[0];
    for (let i = 0; i < 10; i++) await request(server).get('/health').expect(200);
  });
});
