---
name: quest-phase-14-trust-safety
description: Execute QUEST Phase 14 — Trust, Safety & Moderation Hardening. Invoke manually when the previous phase exit gates are complete.
disable-model-invocation: true
---

# QUEST Phase 14 — Trust, Safety & Moderation Hardening

Before starting:

1. Read `CLAUDE.md`, `PROGRESS.md`, `BACKLOG.md`, `ARCHITECTURE_DECISIONS.md`, relevant ADRs and all files affected by this phase.
2. Confirm the previous phase exit gates from repository evidence; do not rely only on prose claims.
3. Use relevant project subagents and reusable skills. Keep specialist exploration out of the main context when it is large.
4. Work in small increments and run tests continuously.

Perform a platform-wide trust & safety hardening phase.

Create versioned policy taxonomy and enforcement states. Harden user/Quest/comment/media/report moderation; dangerous-challenge detection; minors protections; harassment/bullying; sexual content; illegal activity; substance/driving risks; dangerous locations; appeals; moderator queues; case audit history; policy transparency; emergency escalation design where legally/operationally appropriate.

Build adversarial test corpus and measure false positives/false negatives. Review recommendation and growth systems for unsafe incentive loops. Produce a launch readiness risk register.

## Entry conditions

- Phase 13 has passed an independent phase-gate audit (`docs/governance/PHASE_GATE_AUDIT_*.md` with PASS or PASS WITH CONDITIONS) and `PROGRESS.md` records it.
- `pnpm verify` is green on the current baseline and the working tree is committed.
- Read `CLAUDE.md`, `PROGRESS.md`, `BACKLOG.md`, `ARCHITECTURE_DECISIONS.md`, relevant ADRs and `docs/architecture/` before changing anything.

## Exit conditions (all required)

- versioned policy taxonomy and enforcement states, moderation queues, appeals, case audit history, sanctions, transparency and escalation design exist; adversarial corpus with measured FP/FN; recommendation/growth systems reviewed for unsafe loops; launch risk register produced.
- Mandatory closeout below completed; `PROGRESS.md` updated; the next phase is NOT started automatically.

## Mandatory closeout

- Run relevant typecheck/lint/tests/build and record results.
- Perform code review plus security/privacy/safety review appropriate to the phase.
- Update `PROGRESS.md`, `BACKLOG.md`, architecture/API/data docs and ADR index as applicable.
- List known debt and blockers explicitly.
- Do not start the next phase automatically.
