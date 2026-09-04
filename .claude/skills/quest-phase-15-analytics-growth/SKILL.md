---
name: quest-phase-15-analytics-growth
description: Execute QUEST Phase 15 — Analytics & Growth Intelligence. Invoke manually when the previous phase exit gates are complete.
disable-model-invocation: true
---

# QUEST Phase 15 — Analytics & Growth Intelligence

Before starting:
1. Read `CLAUDE.md`, `PROGRESS.md`, `BACKLOG.md`, `ARCHITECTURE_DECISIONS.md`, relevant ADRs and all files affected by this phase.
2. Confirm the previous phase exit gates from repository evidence; do not rely only on prose claims.
3. Use relevant project subagents and reusable skills. Keep specialist exploration out of the main context when it is large.
4. Work in small increments and run tests continuously.


Build a governed event taxonomy and growth analytics layer.

Define canonical events for onboarding, impression, accept, start, evidence, verification, completion, reward, share, invite, report, moderation, churn signals. Define schemas/versioning, consent/privacy, retention, warehouse/data-lake export boundary, dashboards, funnels, cohorts and experiment assignment.

Primary product metrics: acceptance, completion, verified completion, D1/D7/D30 participant retention, invites per completing user, invite activation. Guardrails include safety reports, proof fraud, false moderation, crashes and critical-flow latency.

## Mandatory closeout
- Run relevant typecheck/lint/tests/build and record results.
- Perform code review plus security/privacy/safety review appropriate to the phase.
- Update `PROGRESS.md`, `BACKLOG.md`, architecture/API/data docs and ADR index as applicable.
- List known debt and blockers explicitly.
- Do not start the next phase automatically.
