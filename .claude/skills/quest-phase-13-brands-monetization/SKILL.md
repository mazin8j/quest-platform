---
name: quest-phase-13-brands-monetization
description: Execute QUEST Phase 13 — Brands & Monetization. Invoke manually when the previous phase exit gates are complete.
disable-model-invocation: true
---

# QUEST Phase 13 — Brands & Monetization

Before starting:
1. Read `CLAUDE.md`, `PROGRESS.md`, `BACKLOG.md`, `ARCHITECTURE_DECISIONS.md`, relevant ADRs and all files affected by this phase.
2. Confirm the previous phase exit gates from repository evidence; do not rely only on prose claims.
3. Use relevant project subagents and reusable skills. Keep specialist exploration out of the main context when it is large.
4. Work in small increments and run tests continuously.


Build commercial primitives while preserving participant trust.

Scope: brand account/roles, campaign, Sponsored Quest, reward definition, targeting constraints, budget/status placeholders, disclosure labels, moderation/approval workflow, conversion/participation analytics, fraud controls and billing/payment abstraction boundaries.

Do not implement high-complexity ad auction infrastructure. Sponsored Quests must be clearly labeled and pass the same or stricter safety policy as organic Quests.

## Mandatory closeout
- Run relevant typecheck/lint/tests/build and record results.
- Perform code review plus security/privacy/safety review appropriate to the phase.
- Update `PROGRESS.md`, `BACKLOG.md`, architecture/API/data docs and ADR index as applicable.
- List known debt and blockers explicitly.
- Do not start the next phase automatically.
