# Integration tests

Run only with real infrastructure:

```bash
pnpm infra:up                     # docker compose: PostGIS+pgvector, Redis, MinIO
RUN_INTEGRATION=true \
  DATABASE_URL=postgresql://<user>:<password>@localhost:5432/quest \
  REDIS_URL=redis://localhost:6379 \
  pnpm test:integration           # root script → Turbo
```

Use the **root** script (or `pnpm turbo run test:integration --filter=@quest/api`), not
`pnpm --filter @quest/api test:integration`. The suites import `@quest/types`, `@quest/api-client`,
`@quest/events`, `@quest/config` and `@quest/ai` through their compiled `dist/` entry points, and
only the Turbo task graph (`test:integration` → `^build`) builds them first. Running the package
script directly on a fresh clone fails with `Failed to resolve entry for package "@quest/types"`;
`test/setup.integration.ts` checks the entry points up front and prints the command to run instead
of leaving you with that message. `pnpm build:deps:api` builds just those packages if you want the
package script.

Without `RUN_INTEGRATION=true` the suites are skipped (not silently passed — Vitest reports them as
skipped). CI runs them against the PostGIS+pgvector image built from `infrastructure/docker/postgres`.

## One database per suite

`DATABASE_URL` names the **base** connection. Each suite provisions a database of its own from it —
`quest_it_<test file>`, dropped and recreated in `beforeAll` — and migrates it through the ordinary
`migrateUp` path (`helpers/test-database.ts`, `helpers/create-integration-app.ts`). Today:

| Suite                                   | Database                                                                |
| --------------------------------------- | ----------------------------------------------------------------------- |
| `database.int.test.ts`                  | `quest_it_database` (+ `quest_it_pristine` for the bootstrap invariant) |
| `identity.int.test.ts`                  | `quest_it_identity`                                                     |
| `../e2e/onboarding-journey.e2e.test.ts` | `quest_it_onboarding_journey`                                           |

This exists because the suites previously shared one database and each began with
`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`. Vitest runs files in parallel, so two suites
regularly collided mid-migration — `relation "public"."quest_migrations" does not exist`, duplicate
keys on `pg_type`/`pg_extension`, and cascades of unrelated assertion failures. Isolated databases
remove the shared state instead of serialising the suites, so they still run in parallel.

Consequences worth knowing:

- the test role needs permission to create databases (the compose service and CI service both have
  it); the helper says so explicitly if the grant is missing;
- a failed run leaves its database behind for inspection — the next run recreates it;
- direct SQL assertions must use `harness().databaseUrl` (or the URL the helper returned), never
  `process.env.DATABASE_URL`, which is the base connection;
- every run starts from an empty database, so "a brand-new database is a supported migration
  starting point" is exercised continuously, and `database.int.test.ts` asserts it explicitly.

## Configuration

`test/setup.integration.ts` pins the application configuration the suites depend on (NODE_ENV,
log level, `TRUST_PROXY_HOPS=1`, in-memory mailer, fake identity provider, test JWT secret, stub
object storage) so a developer's local `.env` cannot change what the tests measure. Only
`DATABASE_URL` and `REDIS_URL` come from the environment, and a missing one fails immediately with
the command to run — the unit project's deliberately unreachable ports (`:65432`, `:65433`) are not
used here.

Phase 01 suites: `identity.int.test.ts` (identity & profiles against the real database with an
in-memory mailer and object storage) and `../e2e/onboarding-journey.e2e.test.ts` (the
`@quest/api-client` SDK driving a live HTTP server through the whole onboarding journey). Both run
under the same `test:integration` project and gate.
