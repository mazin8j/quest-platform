# ADR-010 — Drizzle ORM with hand-authored SQL migrations

## Status

Accepted (2026-09-04, Phase 00)

## Context

ADR-002 makes PostgreSQL the system of record with PostGIS/pgvector. The team needs typed queries close to SQL, first-class support for extension-specific column types, and migrations that are reviewable SQL files applied by one code path locally, in CI and in deployment — never automatic schema sync.

## Decision

Use **Drizzle ORM** (`drizzle-orm/node-postgres` over `pg` Pool) for typed queries and **drizzle-kit** only to scaffold migration files (`pnpm db:migrate:generate` → `drizzle-kit generate --custom`). Migrations are SQL under `apps/api/drizzle/` indexed by `meta/_journal.json` and applied by `apps/api/src/cli/migrate.ts` (`db:migrate` up, `db:migrate:status` with non-zero exit when pending). Applied migrations are recorded in `public.quest_migrations`. Development reset (`db:reset:dev`) refuses non-local hosts and production/staging; there is no production reset command. Every migration documents its rollback.

## Alternatives Considered

- **TypeORM** — rejected: heavier, entity-centric, historically weaker type safety; `synchronize` footgun.
- **Prisma** — rejected: limited PostGIS/pgvector support without raw SQL, separate query engine binary, migration engine less transparent.
- **Knex only** — viable for migrations but no typed query layer.
- **Raw `pg` + custom runner** — rejected: reinventing a migration runner.

## Consequences

- Positive: migrations are plain SQL (reviewable, DBA-friendly), extension types are first-class, one runner for all environments, status check is CI-gated.
- Negative: drizzle-kit `generate` from schema diffs must be reviewed carefully once tables exist; team must learn Drizzle's query builder.

## Revisit Triggers

Drizzle blocking a required PostgreSQL feature, or migration volume requiring blue/green schema tooling.
