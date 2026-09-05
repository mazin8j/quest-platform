# 05 — Data Architecture

## Platform (exists)

- PostgreSQL 16 is the system of record (ADR-002). Local: `docker compose` builds
  `infrastructure/docker/postgres` (postgis/postgis:16-3.4 + `postgresql-16-pgvector`). Cloud: RDS
  module with `rds.force_ssl=1`, encrypted storage, RDS-managed master secret.
- Extensions enabled by migration `0000_platform_extensions`: `postgis`, `vector`; helper trigger
  function `quest_set_updated_at()` for audit columns.
- Access: `drizzle-orm/node-postgres` over a `pg` Pool (`DATABASE` token), pool max from config,
  statement timeout 30 s, connection timeout 5 s. Migrations: `apps/api/drizzle/*.sql` +
  `src/cli/migrate.ts` (ADR-010). Verified in CI and locally: clean DB → pending → up → clean → idempotent.
- Redis 7 is cache/counters/rate-limit only; eviction `allkeys-lru`; never a source of truth.
- Object storage holds media; the database stores object keys and metadata, never bytes.

## Conventions for Phase 01+ tables (normative)

| Concern      | Rule                                                                                                                                          |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Primary keys | `uuid` (v7 preferred) generated in the application or `gen_random_uuid()`                                                                     |
| Timestamps   | `created_at timestamptz not null default now()`, `updated_at` maintained by `quest_set_updated_at` trigger                                    |
| Soft delete  | `deleted_at timestamptz null` only for user-facing entities that need restore windows; hard delete for everything else via retention jobs     |
| Audit fields | `created_by`, `updated_by` (actor id) on operator-editable rows                                                                               |
| Foreign keys | Always declared; `ON DELETE RESTRICT` by default; `CASCADE` only inside one aggregate and documented in the migration                         |
| Indexes      | Every FK indexed; composite indexes follow query patterns documented in the migration header; GIST for `geography`, HNSW/IVFFlat for `vector` |
| Naming       | `snake_case`, singular table names per aggregate root (`quest`, `quest_version`), suffix `_ledger` for append-only ledgers                    |
| Pagination   | Cursor on `(created_at, id)` or a dedicated sortable key; no `OFFSET` on public lists                                                         |
| JSON         | `jsonb` only for genuinely schemaless attributes (e.g. provider payloads); never for relational data                                          |
| Enums        | PostgreSQL `text` + CHECK constraint or lookup table; wire values SCREAMING_SNAKE_CASE                                                        |

## Data classification (normative; enforced by review)

| Class        | Examples                                                                                | Handling                                                                                                                |
| ------------ | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| PUBLIC       | published quest title/description                                                       | cacheable, CDN-safe                                                                                                     |
| INTERNAL     | ids, timestamps, counters                                                               | default                                                                                                                 |
| CONFIDENTIAL | email, phone, DOB, IP, device ids                                                       | encrypted at rest (RDS), redacted in logs, minimisation                                                                 |
| RESTRICTED   | **precise location**, identity-linked evidence media, minors' data, safety case details | separate tables, purpose-bound access, retention limits, never in events/analytics, coarse-only exposure to other users |

## Retention & lifecycle (baseline; refined per phase)

- Precise location samples: stored only when a quest requires verification; retained ≤ 30 days
  after verification, then coarsened to city level or deleted.
- Unattached uploads: 3-day S3 lifecycle expiry (`uploads/tmp/`).
- Logs: 14 days dev / 30 days prod (`observability` module).
- Account deletion: cascades through owned aggregates via per-context deletion handlers reacting to
  `identity.account.deleted` (Phase 01 defines the event and the export/delete jobs).

## Backup & recovery

RDS automated backups (3 days dev, 14 prod), point-in-time recovery, final snapshot on delete in
non-dev. Migration rollback: each migration documents its revert SQL; forward-fix preferred.
