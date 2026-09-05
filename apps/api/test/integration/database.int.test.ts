/**
 * Real-database integration test. Requires RUN_INTEGRATION=true and a reachable DATABASE_URL
 * (docker compose up, or the CI service). Verifies the Phase 00 exit gate:
 *   clean database → migrations apply → PostGIS + pgvector available → status shows nothing pending.
 */
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { migrateUp, migrationStatus } from '../../src/cli/migrate';

const enabled = process.env.RUN_INTEGRATION === 'true';
const url = process.env.DATABASE_URL ?? '';

describe.skipIf(!enabled)('database migrations against a real PostgreSQL', () => {
  let client: Client;

  beforeAll(async () => {
    client = new Client({ connectionString: url });
    await client.connect();
    // Start from a clean schema so the test is deterministic across runs.
    await client.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
  });
  afterAll(async () => {
    await client.end();
  });

  it('reports every migration pending on a clean database', async () => {
    const before = await migrationStatus(url);
    expect(before.applied).toHaveLength(0);
    expect(before.pending.length).toBeGreaterThan(0);
  });

  it('applies migrations and enables PostGIS and pgvector', async () => {
    await migrateUp(url);
    const ext = await client.query<{ extname: string }>(
      `SELECT extname FROM pg_extension WHERE extname IN ('postgis', 'vector')`,
    );
    expect(ext.rows.map((r) => r.extname).sort()).toEqual(['postgis', 'vector']);

    const geo = await client.query<{ d: string }>(
      `SELECT ST_Distance(ST_MakePoint(35.93, 31.95)::geography, ST_MakePoint(35.94, 31.95)::geography) AS d`,
    );
    expect(Number(geo.rows[0]?.d)).toBeGreaterThan(900); // ~0.01° lon at 32°N ≈ 945 m

    const vec = await client.query<{ d: number }>(
      `SELECT '[1,0,0]'::vector <-> '[0,1,0]'::vector AS d`,
    );
    expect(Number(vec.rows[0]?.d)).toBeCloseTo(Math.SQRT2, 5);
  });

  it('is idempotent: a second run applies nothing and status is clean', async () => {
    await migrateUp(url);
    const after = await migrationStatus(url);
    expect(after.pending).toHaveLength(0);
    expect(after.applied.length).toBeGreaterThan(0);
  });

  it('records applied migrations in the quest_migrations table', async () => {
    const rows = await client.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM quest_migrations',
    );
    expect(Number(rows.rows[0]?.count)).toBeGreaterThan(0);
  });
});
