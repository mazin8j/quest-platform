---
name: quest-phase-06-ai-intelligence
description: Execute QUEST Phase 06 — QUEST Intelligence & AI Gateway. Invoke manually when the previous phase exit gates are complete.
disable-model-invocation: true
---

# QUEST Phase 06 — QUEST Intelligence & AI Gateway

Before starting:

1. Read `CLAUDE.md`, `PROGRESS.md`, `BACKLOG.md`, `ARCHITECTURE_DECISIONS.md`, relevant ADRs and all files affected by this phase.
2. Confirm the previous phase exit gates from repository evidence; do not rely only on prose claims.
3. Use relevant project subagents and reusable skills. Keep specialist exploration out of the main context when it is large.
4. Work in small increments and run tests continuously.

Implement the AI Gateway and the first four AI capabilities: Quest Generator, Personalization Assistant, Quest Safety Classifier, Proof Analysis Assistant.

First create typed provider-independent task interfaces. Configure Claude through one provider adapter; model identifiers/configuration must be environment/config driven.

For every capability define: input/output JSON schema, prompt/version, latency/cost budget, safety rules, fallback, timeout/retry, redaction, audit fields, evaluation dataset/cases, quality metrics, offline eval command, and human review where applicable.

AI must not be the sole authority for high-risk safety or high-impact proof decisions without policy thresholds and review paths.

Exit: end-to-end AI calls run through the Gateway, eval fixtures exist, failures degrade safely, and feature modules contain no direct provider calls.

## Entry conditions

- Phase 05 has passed an independent phase-gate audit (`docs/governance/PHASE_GATE_AUDIT_*.md` with PASS or PASS WITH CONDITIONS) and `PROGRESS.md` records it.
- `pnpm verify` is green on the current baseline and the working tree is committed.
- Read `CLAUDE.md`, `PROGRESS.md`, `BACKLOG.md`, `ARCHITECTURE_DECISIONS.md`, relevant ADRs and `docs/architecture/` before changing anything.

## Exit conditions (all required)

- AI Gateway core runs end-to-end through a provider adapter with timeout/retry/fallback, structured outputs, prompt versions, audit records and eval fixtures; the four capabilities exist; failures degrade safely; no direct provider calls outside `packages/ai` (depcruise green).
- Mandatory closeout below completed; `PROGRESS.md` updated; the next phase is NOT started automatically.

## Mandatory closeout

- Run relevant typecheck/lint/tests/build and record results.
- Perform code review plus security/privacy/safety review appropriate to the phase.
- Update `PROGRESS.md`, `BACKLOG.md`, architecture/API/data docs and ADR index as applicable.
- List known debt and blockers explicitly.
- Do not start the next phase automatically.
