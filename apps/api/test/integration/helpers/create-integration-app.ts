import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { Client } from 'pg';

import { AppModule } from '../../../src/app.module';
import { configureApp } from '../../../src/bootstrap';
import { migrateUp } from '../../../src/cli/migrate';
import { OBJECT_STORAGE } from '../../../src/infrastructure/object-storage/object-storage.port';
import { InMemoryMailer, MAILER } from '../../../src/modules/identity';
import { InMemoryObjectStorage } from './in-memory-object-storage';

export interface IntegrationApp {
  app: INestApplication;
  mailer: InMemoryMailer;
  storage: InMemoryObjectStorage;
  close(): Promise<void>;
}

/**
 * Boots the real AppModule against the real PostgreSQL (DATABASE_URL) and Redis (REDIS_URL) with
 * an in-memory mailer (to read one-time codes) and an in-memory object storage. The public schema
 * is dropped and migrated from scratch so every run starts clean.
 */
export async function createIntegrationApp(): Promise<IntegrationApp> {
  const url = process.env.DATABASE_URL ?? '';
  const client = new Client({ connectionString: url });
  await client.connect();
  await client.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
  await client.end();
  await migrateUp(url);

  const storage = new InMemoryObjectStorage();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(OBJECT_STORAGE)
    .useValue(storage)
    .compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({
    bufferLogs: true,
    bodyParser: false,
  });
  configureApp(app);
  await app.init();
  const mailer = app.get<InMemoryMailer>(MAILER);
  if (!(mailer instanceof InMemoryMailer))
    throw new Error('Integration tests require MAIL_PROVIDER=memory');
  return { app, mailer, storage, close: () => app.close() };
}
