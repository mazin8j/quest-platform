---
name: quest-phase-10-world-quest
description: Execute QUEST Phase 10 — World Quest. Invoke manually when the previous phase exit gates are complete.
disable-model-invocation: true
---

# QUEST Phase 10 — World Quest

Before starting:
1. Read `CLAUDE.md`, `PROGRESS.md`, `BACKLOG.md`, `ARCHITECTURE_DECISIONS.md`, relevant ADRs and all files affected by this phase.
2. Confirm the previous phase exit gates from repository evidence; do not rely only on prose claims.
3. Use relevant project subagents and reusable skills. Keep specialist exploration out of the main context when it is large.
4. Work in small increments and run tests continuously.


Build World Quest v1 for a single globally coordinated challenge.

Scope: World Quest definition, eligibility window, country/city aggregation, participation and completion counters, progress snapshots, verified completion policy, live-ish public statistics, anti-fraud protections, moderation, regional restrictions and graceful degradation under traffic spikes.

Design counters as eventually consistent where safe. Durable ledger remains source of truth. Add load tests for hot counters and event bursts.

## Mandatory closeout
- Run relevant typecheck/lint/tests/build and record results.
- Perform code review plus security/privacy/safety review appropriate to the phase.
- Update `PROGRESS.md`, `BACKLOG.md`, architecture/API/data docs and ADR index as applicable.
- List known debt and blockers explicitly.
- Do not start the next phase automatically.
