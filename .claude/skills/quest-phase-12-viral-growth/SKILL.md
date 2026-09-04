---
name: quest-phase-12-viral-growth
description: Execute QUEST Phase 12 — Viral Growth Engine. Invoke manually when the previous phase exit gates are complete.
disable-model-invocation: true
---

# QUEST Phase 12 — Viral Growth Engine

Before starting:
1. Read `CLAUDE.md`, `PROGRESS.md`, `BACKLOG.md`, `ARCHITECTURE_DECISIONS.md`, relevant ADRs and all files affected by this phase.
2. Confirm the previous phase exit gates from repository evidence; do not rely only on prose claims.
3. Use relevant project subagents and reusable skills. Keep specialist exploration out of the main context when it is large.
4. Work in small increments and run tests continuously.


Build ethical viral loops around Quest completion.

Scope: challenge-a-friend, deep links, referral attribution, invite lifecycle, Quest Chain graph, external share card metadata, install-to-activation attribution, Crew invites, creator invites, anti-spam limits, block/privacy compliance.

Define growth funnel and viral coefficient instrumentation, but enforce safety and spam guardrails. No dark patterns or forced contact uploads.

## Mandatory closeout
- Run relevant typecheck/lint/tests/build and record results.
- Perform code review plus security/privacy/safety review appropriate to the phase.
- Update `PROGRESS.md`, `BACKLOG.md`, architecture/API/data docs and ADR index as applicable.
- List known debt and blockers explicitly.
- Do not start the next phase automatically.
