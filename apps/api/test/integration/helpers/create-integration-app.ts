import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { expect } from 'vitest';

import { AppModule } from '../../../src/app.module';
import { configureApp } from '../../../src/bootstrap';
import { migrateUp } from '../../../src/cli/migrate';
import { OBJECT_STORAGE } from '../../../src/infrastructure/object-storage/object-storage.port';
import { InMemoryMailer, MAILER } from '../../../src/modules/identity';
import { InMemoryObjectStorage } from './in-memory-object-storage';
import { provisionSuiteDatabase, suiteDatabaseName } from './test-database';

export interface IntegrationApp {
  app: INestApplication;
  mailer: InMemoryMailer;
  storage: InMemoryObjectStorage;
  /** Connection string of this suite's own database — use it for direct SQL assertions. */
  databaseUrl: string;
  close(): Promise<void>;
}

export interface CreateIntegrationAppOptions {
  /** Override the derived database name (must stay inside the `quest_it_` namespace). */
  database?: string;
}

/**
 * Boots the real AppModule against a **database of its own**, created fresh for the calling suite,
 * with an in-memory mailer (to read one-time codes) and in-memory object storage.
 *
 * Suites used to share one database and reset its `public` schema, which raced whenever Vitest ran
 * files in parallel (see `test-database.ts`). Each suite now owns `quest_it_<file>`, provisioned
 * from `DATABASE_URL` and migrated through the ordinary `migrateUp` path — a brand-new database is
 * a supported migration starting point, and this exercises that on every run.
 */
export async function createIntegrationApp(
  options: CreateIntegrationAppOptions = {},
): Promise<IntegrationApp> {
  const baseUrl = process.env.DATABASE_URL;
  if (!baseUrl) throw new Error('Integration tests require DATABASE_URL');
  const database = options.database ?? suiteDatabaseName(expect.getState().testPath ?? 'suite');
  const databaseUrl = await provisionSuiteDatabase(baseUrl, database);
  await migrateUp(databaseUrl);

  // The application reads DATABASE_URL from the environment; point it at this suite's database for
  // as long as the app lives. Vitest isolates each test file in its own worker, so this cannot
  // leak into another suite; `close()` restores the previous value regardless.
  const previousUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = databaseUrl;
  let app: NestExpressApplication | undefined;
  try {
    const storage = new InMemoryObjectStorage();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(OBJECT_STORAGE)
      .useValue(storage)
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({
      bufferLogs: true,
      bodyParser: false,
    });
    configureApp(app);
    await app.init();
    const mailer = app.get<InMemoryMailer>(MAILER);
    if (!(mailer instanceof InMemoryMailer))
      throw new Error('Integration tests require MAIL_PROVIDER=memory');

    let closed = false;
    const close = async (): Promise<void> => {
      if (closed) return; // safe to call twice (afterAll plus an explicit close in a test)
      closed = true;
      process.env.DATABASE_URL = previousUrl;
      await app?.close();
    };
    return { app, mailer, storage, databaseUrl, close };
  } catch (error) {
    // Never leave a half-built application or a mutated environment behind on a failed setup.
    process.env.DATABASE_URL = previousUrl;
    await app?.close().catch(() => undefined);
    throw error;
  }
}
