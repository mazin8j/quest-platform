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

## Entry conditions

- Phase 03 has passed an independent phase-gate audit (`docs/governance/PHASE_GATE_AUDIT_*.md` with PASS or PASS WITH CONDITIONS) and `PROGRESS.md` records it.
- `pnpm verify` is green on the current baseline and the working tree is committed.
- Read `CLAUDE.md`, `PROGRESS.md`, `BACKLOG.md`, `ARCHITECTURE_DECISIONS.md`, relevant ADRs and `docs/architecture/` before changing anything.

## Exit conditions (all required)

- XP ledger, levels, badges, achievements, streaks and passport summary exist with idempotent, retry-safe reward issuance proven by duplicate/concurrent tests; leaderboard v1 backed by durable truth with Redis cache; reversal/correction path tested.
- Mandatory closeout below completed; `PROGRESS.md` updated; the next phase is NOT started automatically.

## Mandatory closeout

- Run relevant typecheck/lint/tests/build and record results.
- Perform code review plus security/privacy/safety review appropriate to the phase.
- Update `PROGRESS.md`, `BACKLOG.md`, architecture/API/data docs and ADR index as applicable.
- List known debt and blockers explicitly.
- Do not start the next phase automatically.
