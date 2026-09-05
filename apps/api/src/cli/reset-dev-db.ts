/**
 * Development-only database reset: drops and recreates the target database, then applies all
 * migrations. Refuses to run unless ALL of the following hold:
 *   - NODE_ENV is not "production" or "staging"
 *   - DATABASE_URL host is localhost/127.0.0.1/::1 (or ALLOW_DB_RESET=true is set explicitly)
 * There is intentionally NO production reset command in this repository.
 */
import { Client } from 'pg';

import { migrateUp } from './migrate';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', 'postgres', 'db']);

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  const env = process.env.NODE_ENV ?? 'development';
  if (env === 'production' || env === 'staging')
    throw new Error(`Refusing to reset database in NODE_ENV=${env}`);

  const parsed = new URL(url);
  if (!LOCAL_HOSTS.has(parsed.hostname) && process.env.ALLOW_DB_RESET !== 'true') {
    throw new Error(
      `Refusing to reset non-local database host "${parsed.hostname}" (set ALLOW_DB_RESET=true to override)`,
    );
  }

  const dbName = parsed.pathname.replace(/^\//, '');
  if (!/^[a-z_][a-z0-9_]*$/.test(dbName)) throw new Error(`Unsafe database name "${dbName}"`);

  const admin = new URL(url);
  admin.pathname = '/postgres';
  const client = new Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    await client.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [dbName],
    );
    await client.query(`DROP DATABASE IF EXISTS "${dbName}"`);
    await client.query(`CREATE DATABASE "${dbName}"`);
  } finally {
    await client.end();
  }
  await migrateUp(url);
  console.log(`Database "${dbName}" reset and migrated.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
