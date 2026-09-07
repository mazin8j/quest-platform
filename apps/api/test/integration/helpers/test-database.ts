import path from 'node:path';

import { Client } from 'pg';

/**
 * Per-suite database provisioning for the integration project.
 *
 * Every integration file used to share one database and start by running
 * `DROP SCHEMA public CASCADE; CREATE SCHEMA public;`. Vitest runs files in parallel, so two
 * suites regularly collided mid-migration — the observed symptoms were
 * `relation "public"."quest_migrations" does not exist` (a peer dropped the schema between our
 * CREATE TABLE and our SELECT), duplicate-key failures on `pg_type` and `pg_extension` (two
 * migrators bootstrapping at once) and a stream of unrelated assertion failures.
 *
 * Each suite now gets its own database, named deterministically after the test file, dropped and
 * recreated at the start of the suite. Nothing is shared, so nothing has to be serialised, and a
 * failed run leaves its database behind for inspection until the next run recreates it.
 */

/** `test/integration/identity.int.test.ts` → `quest_it_identity`. */
export function suiteDatabaseName(testPath: string): string {
  const base = path
    .basename(testPath)
    .replace(/\.(int|e2e)?\.?test\.[cm]?[jt]sx?$/i, '')
    .replace(/[^a-z0-9]+/gi, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
  // PostgreSQL identifiers are capped at 63 bytes; the prefix leaves ample room.
  return `quest_it_${base}`.slice(0, 63);
}

function withDatabase(connectionString: string, database: string): string {
  const url = new URL(connectionString);
  url.pathname = `/${database}`;
  return url.toString();
}

/** Connection string of the maintenance database the suite databases are created from. */
function maintenanceUrl(baseUrl: string): string {
  return baseUrl;
}

/**
 * Drops and recreates `database`, returning its connection string. The caller then runs the normal
 * migration path against it — a brand-new database is a supported starting point.
 */
export async function provisionSuiteDatabase(baseUrl: string, database: string): Promise<string> {
  if (!/^quest_it_[a-z0-9_]+$/.test(database)) {
    throw new Error(`Refusing to provision a database outside the test namespace: ${database}`);
  }
  const admin = new Client({ connectionString: maintenanceUrl(baseUrl) });
  await admin.connect();
  try {
    // FORCE terminates leftover connections from a previous interrupted run (PostgreSQL 13+).
    await admin.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
    await admin.query(`CREATE DATABASE "${database}"`);
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === '42501') {
      throw new Error(
        `The integration suites need permission to create their own databases (CREATE DATABASE ` +
          `"${database}" was denied). Grant CREATEDB to the test role — the docker-compose ` +
          `service already does — see docs/DEVELOPER_SETUP.md "Integration tests".`,
      );
    }
    throw error;
  } finally {
    await admin.end();
  }
  return withDatabase(baseUrl, database);
}

/** Removes a suite database. Only used by tests that provision one outside the app harness. */
export async function dropSuiteDatabase(baseUrl: string, database: string): Promise<void> {
  const admin = new Client({ connectionString: maintenanceUrl(baseUrl) });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
  } finally {
    await admin.end();
  }
}
