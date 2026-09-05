# Integration tests

Run only with real infrastructure:

```bash
docker compose up -d --wait
RUN_INTEGRATION=true DATABASE_URL=postgresql://quest:quest@localhost:5432/quest pnpm --filter @quest/api test:integration
```

Without `RUN_INTEGRATION=true` the suites are skipped (not silently passed — Vitest reports them
as skipped). CI runs them against the PostGIS+pgvector image built from `infrastructure/docker/postgres`.
The database integration test **drops and recreates the public schema** — never point it at a
shared database.
