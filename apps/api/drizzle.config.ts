import { defineConfig } from 'drizzle-kit';

/**
 * drizzle-kit is used ONLY to author migrations (`pnpm db:migrate:generate` creates an empty,
 * timestamped SQL file). Applying migrations goes through src/cli/migrate.ts so the same code
 * path is used locally, in CI and in deployment. Schema push / auto-sync is never used.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/infrastructure/database/schema/index.ts',
  out: './drizzle',
  migrations: { schema: 'public', table: 'quest_migrations' },
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgresql://quest:quest@localhost:5432/quest',
  },
  strict: true,
  verbose: true,
});
