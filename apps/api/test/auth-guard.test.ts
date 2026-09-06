import { Controller, Get, type INestApplication, Module } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { Permission, apiErrorEnvelopeSchema } from '@quest/types';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import {
  AllowStates,
  CurrentPrincipal,
  Public,
  RequirePermission,
  RequireVerifiedEmail,
} from '../src/common/auth/decorators';
import { PRINCIPAL_RESOLVER, type Principal } from '../src/common/auth/principal';
import { getRequestContext } from '../src/common/context/request-context';
import { DATABASE_POOL } from '../src/infrastructure/database/database.module';
import { OBJECT_STORAGE } from '../src/infrastructure/object-storage/object-storage.port';
import { REDIS } from '../src/infrastructure/redis/redis.module';

const principals: Record<string, Principal> = {
  'token-user-000000000000': {
    accountId: 'acc-user',
    sessionId: 's1',
    roles: ['USER'],
    state: 'ACTIVE',
    emailVerified: true,
    ageBand: 'ADULT',
  },
  'token-pending-000000000': {
    accountId: 'acc-pending',
    sessionId: 's2',
    roles: ['USER'],
    state: 'PENDING_VERIFICATION',
    emailVerified: false,
    ageBand: 'ADULT',
  },
  'token-deleting-00000000': {
    accountId: 'acc-del',
    sessionId: 's3',
    roles: ['USER'],
    state: 'DELETION_REQUESTED',
    emailVerified: true,
    ageBand: 'ADULT',
  },
  'token-support-000000000': {
    accountId: 'acc-support',
    sessionId: 's4',
    roles: ['USER', 'SUPPORT'],
    state: 'ACTIVE',
    emailVerified: true,
    ageBand: 'ADULT',
  },
  'token-admin-00000000000': {
    accountId: 'acc-admin',
    sessionId: 's5',
    roles: ['USER', 'SUPER_ADMIN'],
    state: 'ACTIVE',
    emailVerified: true,
    ageBand: 'ADULT',
  },
};

@Controller({ path: 'guard-probe', version: '1' })
class ProbeController {
  @Get('open')
  @Public()
  open(): { actor: string | undefined } {
    return { actor: getRequestContext()?.actorId };
  }

  @Get('default')
  authenticated(@CurrentPrincipal() p: Principal): {
    accountId: string;
    actor: string | undefined;
  } {
    return { accountId: p.accountId, actor: getRequestContext()?.actorId };
  }

  @Get('verified')
  @RequireVerifiedEmail()
  verified(): { ok: true } {
    return { ok: true };
  }

  @Get('deleting-ok')
  @AllowStates('ACTIVE', 'DELETION_REQUESTED')
  deleting(): { ok: true } {
    return { ok: true };
  }

  @Get('support')
  @RequirePermission(Permission.VIEW_USER_SUPPORT_PROFILE)
  support(): { ok: true } {
    return { ok: true };
  }

  @Get('staff-only')
  @RequirePermission(Permission.MANAGE_STAFF)
  manage(): { ok: true } {
    return { ok: true };
  }
}

@Module({ controllers: [ProbeController] })
class ProbeModule {}

describe('AuthGuard: authentication, lifecycle state and permissions (default deny)', () => {
  let app: INestApplication;
  const server = () => app.getHttpServer() as Parameters<typeof request>[0];
  const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule, ProbeModule] })
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
      .overrideProvider(PRINCIPAL_RESOLVER)
      .useValue({ resolve: (token: string) => Promise.resolve(principals[token] ?? null) })
      .compile();
    const nestApp = moduleRef.createNestApplication<NestExpressApplication>({
      bufferLogs: true,
      bodyParser: false,
    });
    configureApp(nestApp);
    await nestApp.init();
    app = nestApp;
  });
  afterAll(async () => {
    await app.close();
  });

  it('lets public routes through and still resolves an optional principal into the request context', async () => {
    expect((await request(server()).get('/v1/guard-probe/open')).body).toEqual({});
    expect(
      (await request(server()).get('/v1/guard-probe/open').set(bearer('token-user-000000000000')))
        .body,
    ).toEqual({ actor: 'acc-user' });
    expect(
      (await request(server()).get('/v1/guard-probe/open').set(bearer('bogus-token-value'))).status,
    ).toBe(200);
  });

  it('requires a valid bearer token everywhere else', async () => {
    const missing = await request(server()).get('/v1/guard-probe/default');
    expect(missing.status).toBe(401);
    expect(apiErrorEnvelopeSchema.parse(missing.body).error.code).toBe('UNAUTHENTICATED');
    expect(
      (await request(server()).get('/v1/guard-probe/default').set(bearer('unknown-token-value')))
        .status,
    ).toBe(401);
    expect(
      (await request(server()).get('/v1/guard-probe/default').set('authorization', 'Basic abc'))
        .status,
    ).toBe(401);
    const ok = await request(server())
      .get('/v1/guard-probe/default')
      .set(bearer('token-user-000000000000'));
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ accountId: 'acc-user', actor: 'acc-user' });
  });

  it('enforces lifecycle state per route', async () => {
    expect(
      (
        await request(server())
          .get('/v1/guard-probe/default')
          .set(bearer('token-pending-000000000'))
      ).status,
    ).toBe(200);
    const deleting = await request(server())
      .get('/v1/guard-probe/default')
      .set(bearer('token-deleting-00000000'));
    expect(deleting.status).toBe(403);
    expect(apiErrorEnvelopeSchema.parse(deleting.body).error.code).toBe('FORBIDDEN');
    expect(
      (
        await request(server())
          .get('/v1/guard-probe/deleting-ok')
          .set(bearer('token-deleting-00000000'))
      ).status,
    ).toBe(200);
  });

  it('enforces verified email and permissions with least privilege', async () => {
    expect(
      (
        await request(server())
          .get('/v1/guard-probe/verified')
          .set(bearer('token-pending-000000000'))
      ).status,
    ).toBe(403);
    expect(
      (
        await request(server())
          .get('/v1/guard-probe/verified')
          .set(bearer('token-user-000000000000'))
      ).status,
    ).toBe(200);
    expect(
      (
        await request(server())
          .get('/v1/guard-probe/support')
          .set(bearer('token-user-000000000000'))
      ).status,
    ).toBe(403);
    expect(
      (
        await request(server())
          .get('/v1/guard-probe/support')
          .set(bearer('token-support-000000000'))
      ).status,
    ).toBe(200);
    expect(
      (
        await request(server())
          .get('/v1/guard-probe/staff-only')
          .set(bearer('token-support-000000000'))
      ).status,
    ).toBe(403);
    expect(
      (
        await request(server())
          .get('/v1/guard-probe/staff-only')
          .set(bearer('token-admin-00000000000'))
      ).status,
    ).toBe(200);
  });

  it('keeps the real identity routes behind authentication', async () => {
    expect((await request(server()).get('/v1/me')).status).toBe(401);
    expect((await request(server()).get('/v1/me/profile')).status).toBe(401);
    expect(
      (
        await request(server())
          .get('/v1/admin/accounts/019203f4-1c3a-7d8e-8b3b-0f4c2a1e5d66')
          .set(bearer('token-user-000000000000'))
      ).status,
    ).toBe(403);
  });
});
