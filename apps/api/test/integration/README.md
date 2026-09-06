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

Phase 01 adds `identity.int.test.ts` (the identity & profiles suite against the real database,
in-memory mailer and object storage; `MAIL_PROVIDER=memory` and `AUTH_FAKE_PROVIDER_ENABLED=true`
are set by `test/setup.ts`) and `../e2e/onboarding-journey.e2e.test.ts` (the `@quest/api-client`
SDK driving a live HTTP server through the whole onboarding journey). Both run under the same
`test:integration` project and gate.
