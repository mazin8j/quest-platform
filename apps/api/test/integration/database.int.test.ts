/**
 * Real-database migration test. Requires RUN_INTEGRATION=true and a reachable DATABASE_URL
 * (docker compose up, or the CI service). Verifies the Phase 00 exit gate:
 *   brand-new database → migrations apply → PostGIS + pgvector available → nothing pending.
 *
 * It provisions its own database (`quest_it_database`) rather than resetting the shared one, so it
 * cannot race the suites running beside it — and so the "EMPTY DATABASE is a supported starting
 * point" invariant is exercised literally, on a database created seconds earlier.
 */
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { migrateUp, migrationStatus } from '../../src/cli/migrate';
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
});
