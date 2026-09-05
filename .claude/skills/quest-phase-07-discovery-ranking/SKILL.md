---
name: quest-phase-07-discovery-ranking
description: Execute QUEST Phase 07 — Discovery & Ranking. Invoke manually when the previous phase exit gates are complete.
disable-model-invocation: true
---

# QUEST Phase 07 — Discovery & Ranking

Before starting:

1. Read `CLAUDE.md`, `PROGRESS.md`, `BACKLOG.md`, `ARCHITECTURE_DECISIONS.md`, relevant ADRs and all files affected by this phase.
2. Confirm the previous phase exit gates from repository evidence; do not rely only on prose claims.
3. Use relevant project subagents and reusable skills. Keep specialist exploration out of the main context when it is large.
4. Work in small increments and run tests continuously.

Build Discovery v1: For You, Trending, Quick Quest, Mystery Quest and relevant category feeds.

Use candidate generation + hard eligibility/safety filters + explainable scoring. Start with deterministic/retrieval scoring and use AI only where it adds measurable value. Capture impression, acceptance, completion and hide/report feedback events.

Define cold-start behavior from onboarding interests; novelty/diversity; creator fairness; repetition penalties; anti-gaming; offline ranking metrics; A/B experiment hooks; guardrails.

Do not optimize primarily for watch time.

## Entry conditions

- Phase 06 has passed an independent phase-gate audit (`docs/governance/PHASE_GATE_AUDIT_*.md` with PASS or PASS WITH CONDITIONS) and `PROGRESS.md` records it.
- `pnpm verify` is green on the current baseline and the working tree is committed.
- Read `CLAUDE.md`, `PROGRESS.md`, `BACKLOG.md`, `ARCHITECTURE_DECISIONS.md`, relevant ADRs and `docs/architecture/` before changing anything.

## Exit conditions (all required)

- For You, Trending, Quick and Mystery surfaces return candidates through eligibility/safety filters and explainable scoring; impression/accept/complete/hide/report feedback captured; cold start and offline metrics defined; guardrail metrics reported.
- Mandatory closeout below completed; `PROGRESS.md` updated; the next phase is NOT started automatically.

## Mandatory closeout

- Run relevant typecheck/lint/tests/build and record results.
- Perform code review plus security/privacy/safety review appropriate to the phase.
- Update `PROGRESS.md`, `BACKLOG.md`, architecture/API/data docs and ADR index as applicable.
- List known debt and blockers explicitly.
- Do not start the next phase automatically.
