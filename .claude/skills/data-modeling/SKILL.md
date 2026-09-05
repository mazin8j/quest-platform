---
name: data-modeling
description: Use for schemas, migrations, PostgreSQL/PostGIS/pgvector decisions, indexing, or data retention.
---

# data-modeling

## Use when

Use for schemas, migrations, PostgreSQL/PostGIS/pgvector decisions, indexing, or data retention.

## Inputs

Domain invariants, expected query patterns, ownership, privacy class of each field; `05_DATA_ARCHITECTURE.md`; ADR-002/010.

## Workflow

1. Start from invariants and query patterns; define keys, constraints, indexes, ownership, classification, retention, deletion/anonymisation.
2. Author the SQL migration (header with purpose, indexes rationale, rollback); update the Drizzle schema.
3. Validate on a clean database (`pnpm db:reset:dev`, `db:migrate:status`); run integration tests.

## Guidance

Start from domain invariants and expected query patterns. Define keys, constraints, indexes, ownership, privacy class, retention, deletion/anonymization behavior, migration/backfill and rollback. Prefer PostgreSQL unless an ADR proves another store is necessary.

## Constraints

PostgreSQL unless an ADR proves otherwise; no automatic schema sync; RESTRICTED data isolated and purpose-bound; ledgers append-only.

## Done when / Exit criteria

Migration + schema + classification/retention entries + tests merged; CI migration job green.
