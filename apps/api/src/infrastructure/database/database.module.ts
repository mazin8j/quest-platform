import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { APP_CONFIG, type AppConfig } from '../../config/app-config';
import * as schema from './schema';

/** DI token: the drizzle database handle. */
export const DATABASE = Symbol('DATABASE');
/** DI token: the raw pg Pool (for health checks / migrations only — domain code uses DATABASE). */
export const DATABASE_POOL = Symbol('DATABASE_POOL');

export type Database = NodePgDatabase<typeof schema>;

export function createPool(config: AppConfig): Pool {
  return new Pool({
    connectionString: config.DATABASE_URL,
    max: config.DATABASE_POOL_MAX,
    ssl: config.DATABASE_SSL ? { rejectUnauthorized: true } : undefined,
    application_name: 'quest-api',
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    statement_timeout: 30_000,
  });
}

/**
 * PostgreSQL is the system of record (ADR-002). Connections are created lazily by the pool, so
 * boot does not fail when the database is down — readiness (/ready) reports it instead.
 */
@Global()
@Module({
  providers: [
    {
      provide: DATABASE_POOL,
      useFactory: (config: AppConfig) => createPool(config),
      inject: [APP_CONFIG],
    },
    {
      provide: DATABASE,
      useFactory: (pool: Pool) => drizzle(pool, { schema }),
      inject: [DATABASE_POOL],
    },
  ],
  exports: [DATABASE, DATABASE_POOL],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
