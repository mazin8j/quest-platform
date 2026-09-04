---
name: quest-phase-16-global-scale
description: Execute QUEST Phase 16 — Global Scale & Extraction Plan. Invoke manually when the previous phase exit gates are complete.
disable-model-invocation: true
---

# QUEST Phase 16 — Global Scale & Extraction Plan

Before starting:
1. Read `CLAUDE.md`, `PROGRESS.md`, `BACKLOG.md`, `ARCHITECTURE_DECISIONS.md`, relevant ADRs and all files affected by this phase.
2. Confirm the previous phase exit gates from repository evidence; do not rely only on prose claims.
3. Use relevant project subagents and reusable skills. Keep specialist exploration out of the main context when it is large.
4. Work in small increments and run tests continuously.


Do not blindly rewrite into microservices. Use production evidence or modeled thresholds to create a global scaling plan.

Review database size/query hotspots, media bandwidth, queue volume, feed/recommendation load, hot counters, regional latency, data residency, availability goals, operational team maturity and cost.

Produce: extraction candidates and triggers; multi-region readiness; data ownership plan; cache/search evolution; event streaming evolution; global object/CDN strategy; disaster recovery; SLOs; capacity model; load-test plan; migration sequencing; cost guardrails.

Implement only low-risk preparatory changes justified now. Large migrations require new ADRs and explicit approval.

## Mandatory closeout
- Run relevant typecheck/lint/tests/build and record results.
- Perform code review plus security/privacy/safety review appropriate to the phase.
- Update `PROGRESS.md`, `BACKLOG.md`, architecture/API/data docs and ADR index as applicable.
- List known debt and blockers explicitly.
- Do not start the next phase automatically.
