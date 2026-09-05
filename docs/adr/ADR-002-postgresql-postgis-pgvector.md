# ADR-002 — PostgreSQL + PostGIS + pgvector as the initial data platform

## Status

Accepted (2026-09-04, Phase 00)

## Context

QUEST needs a transactional system of record (identity, quests, participation ledger, rewards), geospatial queries (nearby quests, geofences, city/country aggregation) and, later, semantic retrieval for recommendations and safety similarity. Introducing a separate geo store and a separate vector store at MVP would triple operational surface and break transactional consistency.

## Decision

PostgreSQL 16 is the single system of record. PostGIS provides geography types and spatial indexes; pgvector provides embedding storage and ANN search. Both extensions are enabled by the first migration (`apps/api/drizzle/0000_platform_extensions.sql`) and are available identically in local Docker (custom image `infrastructure/docker/postgres`) and on AWS RDS. Redis is a cache/counter tier only (CLAUDE.md rule 11). Schema changes are hand-authored SQL migrations applied by `apps/api/src/cli/migrate.ts` (see ADR-010); no automatic schema synchronisation.

## Alternatives Considered

- **DynamoDB** — rejected: weak fit for relational domain, ad-hoc analytics and geospatial joins.
- **MongoDB + Atlas Search/Vector** — rejected: weaker transactional guarantees for ledgers; PostGIS is more mature for geo.
- **Dedicated vector DB (Pinecone/Weaviate)** — deferred: pgvector suffices below ~10M vectors; revisit trigger below.
- **Elasticsearch for geo/search** — deferred to Discovery phase if PostgreSQL FTS/PostGIS prove insufficient.

## Consequences

- Positive: ACID across all contexts; one backup/restore story; one connection pool; PostGIS/pgvector are RDS-supported.
- Negative: vector search at very large scale and heavy full-text search may need offloading later; single writer scaling limits (mitigated by read replicas, then extraction).
- Cost: single `db.t4g.medium` in dev; multi-AZ in production.

## Revisit Triggers

Sustained write saturation on the primary; vector index size > 10M rows or p95 ANN latency > 100 ms; search relevance requirements beyond PostgreSQL FTS; data-residency rules requiring per-region stores.
