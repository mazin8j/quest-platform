import { Body, Controller, type INestApplication, Module, Post } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { apiErrorEnvelopeSchema, isApiErrorEnvelope } from '@quest/types';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { AppModule } from '../src/app.module';
import { Public } from '../src/common/auth/decorators';
import { configureApp } from '../src/bootstrap';
import { ApiError } from '../src/common/filters/api-error';
import { ZodValidationPipe } from '../src/common/pipes/zod-validation.pipe';
import { DATABASE_POOL } from '../src/infrastructure/database/database.module';
import { OBJECT_STORAGE } from '../src/infrastructure/object-storage/object-storage.port';
import { REDIS } from '../src/infrastructure/redis/redis.module';

const echoSchema = z.object({ name: z.string().min(2), age: z.number().int().min(13) });
type Echo = z.infer<typeof echoSchema>;

/**
 * Test-only controller proving the validation pipe + error filter contract end to end.
 * Marked @Public because every route is authenticated by default (Phase 01 AuthGuard); the
 * `secret` route below is deliberately left unmarked to prove default deny.
 */
@Controller({ path: 'test-echo', version: '1' })
@Public()
class EchoController {
  @Post()
  echo(@Body(new ZodValidationPipe(echoSchema)) body: Echo): Echo {
    return body;
  }

  @Post('boom')
  boom(): never {
    throw new Error('database password is hunter2'); // must never reach the client
  }

  @Post('conflict')
  conflict(): never {
    throw ApiError.conflict('Username already taken');
  }
}

@Controller({ path: 'test-secret', version: '1' })
class SecretController {
  @Post()
  secret(): { ok: true } {
    return { ok: true };
  }
}

@Module({ controllers: [EchoController, SecretController] })
class EchoTestModule {}

describe('global validation & error handling', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule, EchoTestModule] })
      .overrideProvider(DATABASE_POOL)
      .useValue({ query: () => Promise.resolve({ rows: [] }), end: () => Promise.resolve() })
      .overrideProvider(REDIS)
      .useValue({
        status: 'ready',
        ping: () => Promise.resolve('PONG'),
        quit: () => Promise.resolve('OK'),
      })
      .overrideProvider(OBJECT_STORAGE)
      .useValue({ ping: () => Promise.resolve(true) })
      .compile();
    const nestApp = moduleRef.createNestApplication<NestExpressApplication>({
      bufferLogs: true,
      bodyParser: false,
    });
    app = configureApp(nestApp);
    await app.init();
  });
  afterAll(async () => {
    await app.close();
  });

  const server = () => app.getHttpServer() as Parameters<typeof request>[0];

  it('accepts a valid body, strips unknown keys', async () => {
    const res = await request(server())
      .post('/v1/test-echo')
      .send({ name: 'Ragad', age: 30, isAdmin: true })
      .expect(201);
    expect(res.body).toEqual({ name: 'Ragad', age: 30 });
  });

  it('returns VALIDATION_ERROR with field-level issues', async () => {
    const res = await request(server())
      .post('/v1/test-echo')
      .send({ name: 'R', age: 9 })
      .expect(400);
    expect(isApiErrorEnvelope(res.body)).toBe(true);
    expect(apiErrorEnvelopeSchema.parse(res.body).error.code).toBe('VALIDATION_ERROR');
    const paths = (apiErrorEnvelopeSchema.parse(res.body).error.issues as { path: string }[])
      .map((i) => i.path)
      .sort();
    expect(paths).toEqual(['age', 'name']);
  });

  it('renders malformed JSON as VALIDATION_ERROR with the contract message', async () => {
    const res = await request(server())
      .post('/v1/test-echo')
      .set('content-type', 'application/json')
      .send('{bad json')
      .expect(400);
    const err = apiErrorEnvelopeSchema.parse(res.body).error;
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.message).toBe('Malformed request body');
  });

  it('maps typed ApiError to its code and status', async () => {
    const res = await request(server()).post('/v1/test-echo/conflict').expect(409);
    expect(apiErrorEnvelopeSchema.parse(res.body).error).toMatchObject({
      code: 'CONFLICT',
      message: 'Username already taken',
    });
  });

  it('never leaks internal error details for unexpected exceptions', async () => {
    const res = await request(server()).post('/v1/test-echo/boom').expect(500);
    expect(apiErrorEnvelopeSchema.parse(res.body).error.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(res.body)).not.toContain('hunter2');
    expect(JSON.stringify(res.body)).not.toContain('stack');
  });

  it('denies unauthenticated access to any route not marked @Public (default deny)', async () => {
    const res = await request(app.getHttpServer() as Parameters<typeof request>[0])
      .post('/v1/test-secret')
      .send({});
    expect(res.status).toBe(401);
    expect(apiErrorEnvelopeSchema.parse(res.body).error.code).toBe('UNAUTHENTICATED');
    const garbage = await request(app.getHttpServer() as Parameters<typeof request>[0])
      .post('/v1/test-secret')
      .set('authorization', 'Bearer not-a-real-token-at-all')
      .send({});
    expect(garbage.status).toBe(401);
  });
});
