/**
 * Real-database migration test. Requires RUN_INTEGRATION=true and a reachable DATABASE_URL
 * (docker compose up, or the CI service). Verifies the Phase 00 exit gate:
 *   brand-new database → migrations apply → PostGIS + pgvector available → nothing pending.
 *
 * It provisions its own database (`quest_it_database`) rather than resetting the shared one, so it
 * cannot race the suites running beside it — and so the "EMPTY DATABASE is a supported starting
 * point" invariant is exercised literally, on a database created seconds earlier.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { Table, getTableName, is } from 'drizzle-orm';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { migrateUp, migrationStatus } from '../../src/cli/migrate';
import * as schema from '../../src/infrastructure/database/schema';
import { provisionSuiteDatabase, suiteDatabaseName } from './helpers/test-database';

const enabled = process.env.RUN_INTEGRATION === 'true';
const baseUrl = process.env.DATABASE_URL ?? '';

describe.skipIf(!enabled)('database migrations against a real PostgreSQL', () => {
  let client: Client | undefined;
  let url: string;

  beforeAll(async () => {
    url = await provisionSuiteDatabase(baseUrl, suiteDatabaseName(__filename));
    client = new Client({ connectionString: url });
    await client.connect();
  });
  afterAll(async () => {
    // Safe when beforeAll failed: nothing was opened.
    await client?.end();
  });

  it('starts from an empty database with no migration ledger of its own', async () => {
    const ledger = await client?.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = 'quest_migrations'
       ) AS exists`,
    );
    // The invariant this suite protects: nothing pre-creates the ledger — the runner must.
    expect(ledger?.rows[0]?.exists).toBe(false);
  });

  it('reports every migration pending on a clean database', async () => {
    const before = await migrationStatus(url);
    expect(before.applied).toHaveLength(0);
    expect(before.pending.length).toBeGreaterThan(0);
  });

  it('applies migrations and enables PostGIS and pgvector', async () => {
    await migrateUp(url);
    const ext = await client?.query<{ extname: string }>(
      `SELECT extname FROM pg_extension WHERE extname IN ('postgis', 'vector')`,
    );
    expect(ext?.rows.map((r) => r.extname).sort()).toEqual(['postgis', 'vector']);

    const geo = await client?.query<{ d: string }>(
      `SELECT ST_Distance(ST_MakePoint(35.93, 31.95)::geography, ST_MakePoint(35.94, 31.95)::geography) AS d`,
    );
    expect(Number(geo?.rows[0]?.d)).toBeGreaterThan(900); // ~0.01° lon at 32°N ≈ 945 m

    const vec = await client?.query<{ d: number }>(
      `SELECT '[1,0,0]'::vector <-> '[0,1,0]'::vector AS d`,
    );
    expect(Number(vec?.rows[0]?.d)).toBeCloseTo(Math.SQRT2, 5);
  });

  it('is idempotent: a second run applies nothing and status is clean', async () => {
    await migrateUp(url);
    const after = await migrationStatus(url);
    expect(after.pending).toHaveLength(0);
    expect(after.applied.length).toBeGreaterThan(0);
  });

  it('records applied migrations in the quest_migrations table', async () => {
    const rows = await client?.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM quest_migrations',
    );
    expect(Number(rows?.rows[0]?.count)).toBeGreaterThan(0);
  });

  /**
   * The bootstrap invariant, end to end and independent of the suite above: a database created
   * moments ago, with no ledger and no schema of ours, reaches "everything applied" through
   * `migrateUp` alone — no manual table creation, no pre-seeded ledger rows.
   */
  it('migrates a pristine database from empty to fully applied with no manual setup', async () => {
    const pristineUrl = await provisionSuiteDatabase(baseUrl, 'quest_it_pristine');
    const pristine = new Client({ connectionString: pristineUrl });
    await pristine.connect();
    try {
      const ledgerBefore = await pristine.query<{ exists: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM information_schema.tables
           WHERE table_schema = 'public' AND table_name = 'quest_migrations'
         ) AS exists`,
      );
      expect(ledgerBefore.rows[0]?.exists).toBe(false);

      await migrateUp(pristineUrl);

      const status = await migrationStatus(pristineUrl);
      expect(status.pending).toHaveLength(0);
      expect(status.applied.map((a) => a.tag)).toEqual([
        '0000_platform_extensions',
        '0001_identity_profiles',
        '0002_quest_core',
      ]);
      const tables = await pristine.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name IN ('quest_migrations', 'account', 'profile')
         ORDER BY table_name`,
      );
      expect(tables.rows.map((r) => r.table_name)).toEqual([
        'account',
        'profile',
        'quest_migrations',
      ]);
    } finally {
      await pristine.end();
    }
  });

  /**
   * Schema-mirror parity (audit P02-15).
   *
   * The hand-authored SQL is the source of truth, but drizzle-kit computes its next snapshot from
   * the TypeScript mirror. A mirror that omits an index or a CHECK makes the next `generate` emit
   * a DROP for it — which is how the publication gate could disappear from the database without
   * anyone editing a migration. This test compares what the mirror declares against what the
   * migrated database actually has, so the two cannot drift silently.
   */
  it('keeps the Drizzle schema mirror in step with the migrated database', async () => {
    const tables = await client?.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name LIKE 'quest%'
         AND table_name NOT IN ('quest_migrations')
       ORDER BY table_name`,
    );
    const declaredTables = new Set(
      Object.values(schema)
        .filter((t) => is(t, Table))
        .map((t) => getTableName(t)),
    );
    for (const row of tables?.rows ?? []) {
      expect(declaredTables, `${row.table_name} is missing from the schema mirror`).toContain(
        row.table_name,
      );
    }

    // Every constraint and index the Quest migration creates must be described by the mirror, so
    // a regenerated snapshot cannot drop it.
    //
    // Matched against the mirror's CODE, not its raw text. Substring-matching the whole file let
    // the check pass on a name that appears only in the file's own header comment: deleting the
    // `check('quest_published_requires_assessment', ...)` call left the docblock mention behind
    // and the test still passed, so the one object it exists to protect was unprotected
    // (audit P02-40). Comments are stripped and the name must appear as a `check('name'` /
    // `index('name'` / `uniqueIndex('name'` declaration.
    const rawSource = readFileSync(
      path.join(__dirname, '../../src/infrastructure/database/schema/quests.ts'),
      'utf8',
    );
    const source = rawSource
      .replace(/\/\*[\s\S]*?\*\//g, '') // block comments, including the file header
      .replace(/\/\/.*$/gm, ''); // line comments
    const declares = (kind: string, name: string): boolean =>
      new RegExp(`${kind}\\(\\s*'${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`).test(source);

    const constraints = await client?.query<{ conname: string }>(
      `SELECT conname FROM pg_constraint c
       JOIN pg_class t ON t.oid = c.conrelid
       WHERE t.relname LIKE 'quest%' AND c.contype = 'c'
       ORDER BY conname`,
    );
    // Guard against a vacuous pass: the migration creates exactly 14 CHECKs and 13 indexes.
    expect(constraints?.rows.length ?? 0).toBe(14);
    for (const row of constraints?.rows ?? []) {
      expect(
        declares('check', row.conname),
        `CHECK ${row.conname} is not declared in the schema mirror`,
      ).toBe(true);
    }
    const indexes = await client?.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes
       WHERE schemaname = 'public' AND tablename LIKE 'quest%'
         AND indexname NOT LIKE '%_pkey' AND tablename <> 'quest_migrations'
       ORDER BY indexname`,
    );
    expect(indexes?.rows.length ?? 0).toBe(13);
    for (const row of indexes?.rows ?? []) {
      expect(
        declares('index', row.indexname) || declares('uniqueIndex', row.indexname),
        `index ${row.indexname} is not declared in the schema mirror`,
      ).toBe(true);
    }

    // The one object the mirror cannot express (a circular table-level foreign key) is asserted
    // directly, so "documented in a comment" is backed by a check.
    const fk = await client?.query(
      `SELECT 1 FROM pg_constraint WHERE conname = 'quest_published_assessment_fk'`,
    );
    expect(fk?.rowCount, 'quest_published_assessment_fk must exist').toBe(1);
  });
});
