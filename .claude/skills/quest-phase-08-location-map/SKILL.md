---
name: quest-phase-08-location-map
description: Execute QUEST Phase 08 — Location & Quest Map. Invoke manually when the previous phase exit gates are complete.
disable-model-invocation: true
---

# QUEST Phase 08 — Location & Quest Map

Before starting:
1. Read `CLAUDE.md`, `PROGRESS.md`, `BACKLOG.md`, `ARCHITECTURE_DECISIONS.md`, relevant ADRs and all files affected by this phase.
2. Confirm the previous phase exit gates from repository evidence; do not rely only on prose claims.
3. Use relevant project subagents and reusable skills. Keep specialist exploration out of the main context when it is large.
4. Work in small increments and run tests continuously.


Build geospatial QUEST experiences using PostGIS.

Scope: opt-in device location permissions, coarse vs precise storage policy, nearby Quest search, geofenced eligibility where necessary, city/country entities, map clusters, distance filters, location privacy controls and location-abuse prevention.

Never expose precise user locations to other users by default. Define safe handling for minors and sensitive locations.

Implement indexed geospatial queries, test boundary cases and create performance fixtures.

## Mandatory closeout
- Run relevant typecheck/lint/tests/build and record results.
- Perform code review plus security/privacy/safety review appropriate to the phase.
- Update `PROGRESS.md`, `BACKLOG.md`, architecture/API/data docs and ADR index as applicable.
- List known debt and blockers explicitly.
- Do not start the next phase automatically.
