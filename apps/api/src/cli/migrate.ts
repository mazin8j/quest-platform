/**
 * Migration runner — the single code path for applying SQL migrations locally, in CI and in
 * deployment (never `drizzle-kit push`, never `synchronize`).
 *
 *   pnpm db:migrate            → apply pending migrations (transactional, in journal order)
 *   pnpm db:migrate:status     → list applied / pending migrations, exit 1 if pending
 *   production image:          node dist/cli/migrate.js up   (run as a one-off task before deploy)
 *
 * Migrations live in apps/api/drizzle/*.sql and are indexed by drizzle/meta/_journal.json.
 * Applied migrations are recorded in public.quest_migrations (hash + created_at).
 */
import './load-env';

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

// Works from both src/cli (tsx) and dist/cli (compiled): apps/api/<src|dist>/cli → apps/api/drizzle
const MIGRATIONS_FOLDER = path.resolve(__dirname, '..', '..', 'drizzle');
const MIGRATIONS_TABLE = 'quest_migrations';
const MIGRATIONS_SCHEMA = 'public';

interface JournalEntry {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
}

function readJournal(): JournalEntry[] {
  const journal = JSON.parse(
    readFileSync(path.join(MIGRATIONS_FOLDER, 'meta', '_journal.json'), 'utf8'),
  ) as { entries: JournalEntry[] };
  return journal.entries;
}

function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(2);
  }
  return url;
}

export async function migrateUp(databaseUrl: string): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  try {
    const db = drizzle(pool);
    await migrate(db, {
      migrationsFolder: MIGRATIONS_FOLDER,
      migrationsTable: MIGRATIONS_TABLE,
      migrationsSchema: MIGRATIONS_SCHEMA,
    });
  } finally {
    await pool.end();
  }
}

export interface MigrationStatus {
  applied: { tag: string; when: number }[];
  pending: { tag: string; when: number }[];
}

export async function migrationStatus(databaseUrl: string): Promise<MigrationStatus> {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  try {
    const exists = await pool.query<{ exists: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2) AS exists`,
      [MIGRATIONS_SCHEMA, MIGRATIONS_TABLE],
    );
    const appliedWhen = new Set<number>();
    if (exists.rows[0]?.exists) {
      const rows = await pool.query<{ created_at: string }>(
        `SELECT created_at FROM ${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE}`,
      );
      for (const r of rows.rows) appliedWhen.add(Number(r.created_at));
    }
    const journal = readJournal();
    return {
      applied: journal
        .filter((e) => appliedWhen.has(e.when))
        .map((e) => ({ tag: e.tag, when: e.when })),
      pending: journal
        .filter((e) => !appliedWhen.has(e.when))
        .map((e) => ({ tag: e.tag, when: e.when })),
    };
  } finally {
    await pool.end();
  }
}

async function main(): Promise<void> {
  const command = process.argv[2];
  const url = requireDatabaseUrl();
  switch (command) {
    case 'up': {
      await migrateUp(url);
      const status = await migrationStatus(url);
      console.log(
        `Migrations applied: ${status.applied.length}, pending: ${status.pending.length}`,
      );
      return;
    }
    case 'status': {
      const status = await migrationStatus(url);
      for (const a of status.applied) console.log(`applied  ${a.tag}`);
      for (const p of status.pending) console.log(`pending  ${p.tag}`);
      if (status.pending.length > 0) process.exit(1);
      return;
    }
    default:
      console.error('Usage: migrate.ts <up|status>');
      process.exit(2);
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
