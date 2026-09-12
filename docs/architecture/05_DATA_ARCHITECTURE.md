# 05 — Data Architecture

## Platform (exists)

- PostgreSQL 16 is the system of record (ADR-002). Local and CI: `docker compose` builds
  `infrastructure/docker/postgres` from **`postgres:16-bookworm`** (the official image on Debian 12),
  adding `postgresql-16-postgis-3`, `postgresql-16-postgis-3-scripts` and `postgresql-16-pgvector`
  from the PGDG repository the base image already has configured and signed. Cloud: RDS module with
  `rds.force_ssl=1`, encrypted storage, RDS-managed master secret.

  The base was `postgis/postgis:16-3.4` until 2026-09-12. That image is Debian 11 (bullseye); once
  the `bullseye-security` Release metadata expired, `apt-get update` inside the build failed its
  validity check and the image stopped building, so CI failed on the base image rather than on
  anything in this repository. `postgis/postgis:16-3.5` is not a fix — it is still
  `FROM postgres:16-bullseye` upstream — and the `16-3.4` variant no longer exists upstream at all.
  The fix is the supported Debian release, never an APT override: `Acquire::Check-Valid-Until=false`,
  `--allow-unauthenticated`, `apt-key` and unsigned repositories are all forbidden here, because a
  build that skips signature validation is a build that installs whatever answers the request.

  Extension packages are versioned to the server's major (`postgresql-16-*`): Debian 12's own archive
  carries PostgreSQL 15, so an unversioned name would install the wrong build or a second server. The
  image asserts at build time that `postgis.control` and `vector.control` are present under
  `pg_config --sharedir`, so a renamed or dropped package fails the build instead of failing a
  migration. `postgresql-16-postgis-3-scripts` is required rather than optional: it supplies the
  extension control and upgrade SQL, including the `update-alternatives` link that makes the
  unversioned `CREATE EXTENSION postgis` resolve.

  The image ships **no** `/docker-entrypoint-initdb.d` script. `postgis/postgis` shipped one that
  created the extension in `template1` and in `POSTGRES_DB`, which meant every database inherited
  PostGIS before migration `0000` ran, and that migration's own work was never exercised. Extension
  creation has one owner — the migration — so local, CI and cloud converge through the same code
  path; the integration harness creates each per-suite database and runs `migrateUp` against it, and
  depends on nothing in the template.

- Extensions enabled by migration `0000_platform_extensions`: `postgis`, `vector`; helper trigger
  function `quest_set_updated_at()` for audit columns.
- Access: `drizzle-orm/node-postgres` over a `pg` Pool (`DATABASE` token), pool max from config,
  statement timeout 30 s, connection timeout 5 s. Migrations: `apps/api/drizzle/*.sql` +
  `src/cli/migrate.ts` (ADR-010). Verified in CI and locally: clean DB → pending → up → clean → idempotent.
- Redis 7 is cache/counters/rate-limit only; eviction `allkeys-lru`; never a source of truth.
- Object storage holds media; the database stores object keys and metadata, never bytes.

## Phase 01 tables

Identity & Profiles: 16 tables in migration `0001_identity_profiles` — model, indexes, deletion
cascade and export contract in [`docs/data/IDENTITY_DATA_MODEL.md`](../data/IDENTITY_DATA_MODEL.md);
per-column classification in [`docs/security/IDENTITY_PRIVACY_CLASSIFICATION.md`](../security/IDENTITY_PRIVACY_CLASSIFICATION.md).

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
- Account deletion: 30-day grace, then `AccountDeletionJob` anonymises the account, hard-deletes
  credentials/sessions/devices/codes, erases the profile aggregate in the same transaction and
  publishes `identity.account.deleted`; every other context erases its own data in an idempotent
  handler (implemented in Phase 01 — `docs/data/IDENTITY_DATA_MODEL.md`).

## Backup & recovery

RDS automated backups (3 days dev, 14 prod), point-in-time recovery, final snapshot on delete in
non-dev. Migration rollback: each migration documents its revert SQL; forward-fix preferred.
