---
name: quest-phase-11-creators
description: Execute QUEST Phase 11 — Creator Platform. Invoke manually when the previous phase exit gates are complete.
disable-model-invocation: true
---

# QUEST Phase 11 — Creator Platform

Before starting:
1. Read `CLAUDE.md`, `PROGRESS.md`, `BACKLOG.md`, `ARCHITECTURE_DECISIONS.md`, relevant ADRs and all files affected by this phase.
2. Confirm the previous phase exit gates from repository evidence; do not rely only on prose claims.
3. Use relevant project subagents and reusable skills. Keep specialist exploration out of the main context when it is large.
4. Work in small increments and run tests continuously.


Build creator capabilities without creating follower-count lock-in.

Scope: creator profile/status, creator Quest management, templates, audience eligibility, analytics for impressions/acceptances/completions/verified completions/invites, creator safety/compliance, featured Quest workflow and quality scoring.

Design distribution signals around Quest quality and participant outcomes. Add moderation and anti-manipulation controls.

## Mandatory closeout
- Run relevant typecheck/lint/tests/build and record results.
- Perform code review plus security/privacy/safety review appropriate to the phase.
- Update `PROGRESS.md`, `BACKLOG.md`, architecture/API/data docs and ADR index as applicable.
- List known debt and blockers explicitly.
- Do not start the next phase automatically.
