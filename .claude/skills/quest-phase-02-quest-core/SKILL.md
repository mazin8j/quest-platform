---
name: quest-phase-02-quest-core
description: Execute QUEST Phase 02 — Quest Core Engine. Invoke manually when the previous phase exit gates are complete.
disable-model-invocation: true
---

# QUEST Phase 02 — Quest Core Engine

Before starting:

1. Read `CLAUDE.md`, `PROGRESS.md`, `BACKLOG.md`, `ARCHITECTURE_DECISIONS.md`, relevant ADRs and all files affected by this phase.
2. Confirm the previous phase exit gates from repository evidence; do not rely only on prose claims.
3. Use relevant project subagents and reusable skills. Keep specialist exploration out of the main context when it is large.
4. Work in small increments and run tests continuously.

Implement the authoritative Quest lifecycle.

Scope: Quest draft/create/edit/publish/archive; categories; title/description/instructions; difficulty; estimated duration; evidence requirements; optional location constraints; eligibility; safety state placeholder/hook; Quest versioning after publication; accept/start/cancel/complete-intent lifecycle; participation state machine; creator ownership and authorization.

Do not grant final XP for unverified evidence yet.

Required: domain invariants, state transition table, schema/migrations, API contracts, domain events, idempotency, concurrency protection, abuse cases, observability, tests. Integrate `quest-safety` gate into publishing even if the first policy engine is rule-based.

Exit: users can create a safe Quest, publish it, discover a basic non-ranked list, accept it, start it and reach proof-required completion state.

## Entry conditions

- Phase 01 has passed an independent phase-gate audit (`docs/governance/PHASE_GATE_AUDIT_*.md` with PASS or PASS WITH CONDITIONS) and `PROGRESS.md` records it.
- `pnpm verify` is green on the current baseline and the working tree is committed.
- Read `CLAUDE.md`, `PROGRESS.md`, `BACKLOG.md`, `ARCHITECTURE_DECISIONS.md`, relevant ADRs and `docs/architecture/` before changing anything.

## Exit conditions (all required)

- users can create a Quest, pass the safety publish gate (`SafetyDecisionPort` + `canPublishWithAssessment`), publish, discover a basic non-ranked list, accept, start and reach proof-required completion; state-transition table and domain events implemented with idempotency/concurrency tests; no path publishes without a fresh publishable assessment.
- Mandatory closeout below completed; `PROGRESS.md` updated; the next phase is NOT started automatically.

## Mandatory closeout

- Run relevant typecheck/lint/tests/build and record results.
- Perform code review plus security/privacy/safety review appropriate to the phase.
- Update `PROGRESS.md`, `BACKLOG.md`, architecture/API/data docs and ADR index as applicable.
- List known debt and blockers explicitly.
- Do not start the next phase automatically.
