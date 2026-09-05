import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';

import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap';
import { DATABASE_POOL } from '../../src/infrastructure/database/database.module';
import { OBJECT_STORAGE } from '../../src/infrastructure/object-storage/object-storage.port';
import { REDIS } from '../../src/infrastructure/redis/redis.module';

export interface FakeDependencies {
  postgresUp: boolean;
  redisUp: boolean;
  storageUp: boolean;
}

/**
 * Boots the real AppModule through the real HTTP pipeline (configureApp: helmet, CORS,
 * versioning, filters, middleware) with infrastructure clients replaced by controllable fakes,
 * so unit tests never need a database. Integration tests boot with real clients instead.
 */
export async function createTestApp(
  deps: FakeDependencies = { postgresUp: true, redisUp: true, storageUp: true },
): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DATABASE_POOL)
    .useValue({
      query: () =>
        deps.postgresUp
          ? Promise.resolve({ rows: [{ '?column?': 1 }] })
          : Promise.reject(new Error('ECONNREFUSED')),
      end: () => Promise.resolve(),
    })
    .overrideProvider(REDIS)
    .useValue({
      status: 'ready',
      connect: () => Promise.resolve(),
      ping: () =>
        deps.redisUp ? Promise.resolve('PONG') : Promise.reject(new Error('ECONNREFUSED')),
      quit: () => Promise.resolve('OK'),
    })
    .overrideProvider(OBJECT_STORAGE)
    .useValue({ ping: () => Promise.resolve(deps.storageUp) })
    .compile();

  const app = moduleRef.createNestApplication<NestExpressApplication>({
    bufferLogs: true,
    bodyParser: false,
  });
  configureApp(app);
  await app.init();
  return app;
}
