---
name: data-modeling
description: Use for schemas, migrations, PostgreSQL/PostGIS/pgvector decisions, indexing, or data retention.
---

Start from domain invariants and expected query patterns. Define keys, constraints, indexes, ownership, privacy class, retention, deletion/anonymization behavior, migration/backfill and rollback. Prefer PostgreSQL unless an ADR proves another store is necessary.
