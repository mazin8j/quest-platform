---
name: quest-phase-03-social-graph
description: Execute QUEST Phase 03 — Social Graph. Invoke manually when the previous phase exit gates are complete.
disable-model-invocation: true
---

# QUEST Phase 03 — Social Graph

Before starting:

1. Read `CLAUDE.md`, `PROGRESS.md`, `BACKLOG.md`, `ARCHITECTURE_DECISIONS.md`, relevant ADRs and all files affected by this phase.
2. Confirm the previous phase exit gates from repository evidence; do not rely only on prose claims.
3. Use relevant project subagents and reusable skills. Keep specialist exploration out of the main context when it is large.
4. Work in small increments and run tests continuously.

Implement social relationships and basic social interactions around Quests.

Scope: follow/unfollow, optional friend/mutual concept if retained by product decision, block, mute, comments, reactions, share records, invite another user to a Quest, activity events. Define privacy interaction rules and block precedence clearly.

Do not implement large-scale feed ranking yet.

Required: anti-spam/rate limits, authorization matrix, block/mute privacy semantics, notification events (not full notification product if absent), API contracts, indexes/query patterns, moderation/reporting hooks, tests.

## Entry conditions

- Phase 02 has passed an independent phase-gate audit (`docs/governance/PHASE_GATE_AUDIT_*.md` with PASS or PASS WITH CONDITIONS) and `PROGRESS.md` records it.
- `pnpm verify` is green on the current baseline and the working tree is committed.
- Read `CLAUDE.md`, `PROGRESS.md`, `BACKLOG.md`, `ARCHITECTURE_DECISIONS.md`, relevant ADRs and `docs/architecture/` before changing anything.

## Exit conditions (all required)

- follow/unfollow, block, mute, comments, reactions, share records and quest invitations work with a tested authorization matrix and block precedence; anti-spam rate limits in place; report entity and moderation hooks exist; notification events emitted.
- Mandatory closeout below completed; `PROGRESS.md` updated; the next phase is NOT started automatically.

## Mandatory closeout

- Run relevant typecheck/lint/tests/build and record results.
- Perform code review plus security/privacy/safety review appropriate to the phase.
- Update `PROGRESS.md`, `BACKLOG.md`, architecture/API/data docs and ADR index as applicable.
- List known debt and blockers explicitly.
- Do not start the next phase automatically.
