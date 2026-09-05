---
name: quest-phase-09-crews-community
description: Execute QUEST Phase 09 — Crews & Community. Invoke manually when the previous phase exit gates are complete.
disable-model-invocation: true
---

# QUEST Phase 09 — Crews & Community

Before starting:

1. Read `CLAUDE.md`, `PROGRESS.md`, `BACKLOG.md`, `ARCHITECTURE_DECISIONS.md`, relevant ADRs and all files affected by this phase.
2. Confirm the previous phase exit gates from repository evidence; do not rely only on prose claims.
3. Use relevant project subagents and reusable skills. Keep specialist exploration out of the main context when it is large.
4. Work in small increments and run tests continuously.

Build Crews as persistent communities for collective participation.

Scope: create Crew, public/private/discoverable policies, join/request/invite, roles, membership moderation, Crew Quest, collective progress, Crew leaderboard, Crew activity, leave/remove/ban, reporting.

Define ownership transfer, abandoned Crew handling, abuse/spam prevention and privacy. Keep permissions server-authoritative and tested.

## Entry conditions

- Phase 08 has passed an independent phase-gate audit (`docs/governance/PHASE_GATE_AUDIT_*.md` with PASS or PASS WITH CONDITIONS) and `PROGRESS.md` records it.
- `pnpm verify` is green on the current baseline and the working tree is committed.
- Read `CLAUDE.md`, `PROGRESS.md`, `BACKLOG.md`, `ARCHITECTURE_DECISIONS.md`, relevant ADRs and `docs/architecture/` before changing anything.

## Exit conditions (all required)

- crews with public/private/discoverable policies, join/request/invite, roles, moderation, crew quests, collective progress and leaderboards work with server-authoritative permission tests; ownership transfer and abandoned-crew handling defined.
- Mandatory closeout below completed; `PROGRESS.md` updated; the next phase is NOT started automatically.

## Mandatory closeout

- Run relevant typecheck/lint/tests/build and record results.
- Perform code review plus security/privacy/safety review appropriate to the phase.
- Update `PROGRESS.md`, `BACKLOG.md`, architecture/API/data docs and ADR index as applicable.
- List known debt and blockers explicitly.
- Do not start the next phase automatically.
