# Data documentation

- Architecture, conventions, classification, retention: [`../architecture/05_DATA_ARCHITECTURE.md`](../architecture/05_DATA_ARCHITECTURE.md)
- Decisions: [ADR-002](../adr/ADR-002-postgresql-postgis-pgvector.md) (platform), [ADR-010](../adr/ADR-010-drizzle-sql-migrations.md) (migrations)
- Identity & Profiles model, deletion cascade, export contract: [`IDENTITY_DATA_MODEL.md`](IDENTITY_DATA_MODEL.md)

## Migration authoring checklist

1. `pnpm --filter @quest/api db:migrate:generate --name <context>_<change>` → edit the SQL file under `apps/api/drizzle/`.
2. Header comment: purpose, owning context, query patterns the indexes serve, **rollback SQL**.
3. Use `--> statement-breakpoint` between statements; keep migrations additive and backward compatible with the currently deployed API (expand → migrate → contract).
4. Add/adjust the Drizzle schema under `apps/api/src/infrastructure/database/schema/<context>.ts` and re-export from `index.ts`.
5. Run `pnpm db:reset:dev && pnpm db:migrate:status` locally; CI applies migrations on a clean PostGIS+pgvector database and runs the integration suite.
6. Data classification and retention for every new column are recorded in the migration header (PUBLIC / INTERNAL / CONFIDENTIAL / RESTRICTED).
