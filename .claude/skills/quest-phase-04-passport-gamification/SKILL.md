---
name: quest-phase-04-passport-gamification
description: Execute QUEST Phase 04 — Quest Passport & Gamification. Invoke manually when the previous phase exit gates are complete.
disable-model-invocation: true
---

# QUEST Phase 04 — Quest Passport & Gamification

Before starting:
1. Read `CLAUDE.md`, `PROGRESS.md`, `BACKLOG.md`, `ARCHITECTURE_DECISIONS.md`, relevant ADRs and all files affected by this phase.
2. Confirm the previous phase exit gates from repository evidence; do not rely only on prose claims.
3. Use relevant project subagents and reusable skills. Keep specialist exploration out of the main context when it is large.
4. Work in small increments and run tests continuously.


Build a ledger-based rewards system and Quest Passport.

Scope: XP transaction ledger, levels, badges, achievements, streak policy, passport summary, verified/unverified distinction, leaderboard v1 with Redis cache backed by durable truth, anti-double-award idempotency.

Do not introduce a token/cryptocurrency economy.

Define abuse resistance, reward reversal/correction, seasonal reset semantics where applicable, accessibility and clear explanations for rewards. Add tests for duplicate events, retries and concurrent completion processing.

## Mandatory closeout
- Run relevant typecheck/lint/tests/build and record results.
- Perform code review plus security/privacy/safety review appropriate to the phase.
- Update `PROGRESS.md`, `BACKLOG.md`, architecture/API/data docs and ADR index as applicable.
- List known debt and blockers explicitly.
- Do not start the next phase automatically.
