import { Controller, Get, HttpCode, Inject, Res, VERSION_NEUTRAL } from '@nestjs/common';
import type { LivenessResponse, ReadinessResponse } from '@quest/types';
import type { Response } from 'express';
import type { Redis } from 'ioredis';
import type { Pool } from 'pg';

import { Public } from '../common/auth/decorators';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { DATABASE_POOL } from '../infrastructure/database/database.module';
import {
  OBJECT_STORAGE,
  type ObjectStoragePort,
} from '../infrastructure/object-storage/object-storage.port';
import { REDIS } from '../infrastructure/redis/redis.module';
import { SERVICE_NAME, SERVICE_VERSION } from '../version';

const CHECK_TIMEOUT_MS = 2_000;

async function timed<T>(
  fn: () => Promise<T>,
): Promise<{ ok: true; latencyMs: number } | { ok: false; latencyMs: number; detail: string }> {
  const start = Date.now();
  try {
    await Promise.race([
      fn(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), CHECK_TIMEOUT_MS)),
    ]);
    return { ok: true, latencyMs: Date.now() - start };
  } catch (error) {
    // Safe summary only: an error code/name, never hosts, ports, connection strings or driver text.
    const code = (error as { code?: unknown }).code;
    const detail =
      typeof code === 'string'
        ? code
        : error instanceof Error && error.message === 'timeout'
          ? 'TIMEOUT'
          : 'UNAVAILABLE';
    return { ok: false, latencyMs: Date.now() - start, detail };
  }
}

/**
 * /health — liveness (process up; never touches dependencies).
 * /ready  — readiness (PostgreSQL + Redis reachable; object storage reported but non-blocking).
 * Both are version-neutral so orchestrators never need to know the API version.
 */
@Controller({ path: '', version: VERSION_NEUTRAL })
@Public()
export class HealthController {
  private readonly startedAt = Date.now();

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStoragePort,
  ) {}

  @Get('health')
  @HttpCode(200)
  liveness(): LivenessResponse {
    return {
      status: 'ok',
      service: SERVICE_NAME,
      version: SERVICE_VERSION,
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
      timestamp: new Date().toISOString(),
    };
  }

  @Get('ready')
  async readiness(@Res({ passthrough: true }) res: Response): Promise<ReadinessResponse> {
    const [db, redis, storage] = await Promise.all([
      timed(async () => {
        await this.pool.query('SELECT 1');
      }),
      timed(async () => {
        if (this.redis.status === 'wait') await this.redis.connect();
        await this.redis.ping();
      }),
      timed(async () => {
        if (!(await this.storage.ping())) throw new Error('bucket unreachable');
      }),
    ]);

    const checks: ReadinessResponse['checks'] = {
      postgres: db.ok
        ? { status: 'up', latencyMs: db.latencyMs }
        : { status: 'down', latencyMs: db.latencyMs, detail: db.detail },
      redis: redis.ok
        ? { status: 'up', latencyMs: redis.latencyMs }
        : { status: 'down', latencyMs: redis.latencyMs, detail: redis.detail },
      objectStorage: storage.ok
        ? { status: 'up', latencyMs: storage.latencyMs }
        : { status: 'down', latencyMs: storage.latencyMs, detail: storage.detail },
    };

    const critical = db.ok && redis.ok;
    const status: ReadinessResponse['status'] = critical
      ? storage.ok
        ? 'ok'
        : 'degraded'
      : 'error';
    res.status(critical ? 200 : 503);
    return { status, checks, timestamp: new Date().toISOString() };
  }
}
