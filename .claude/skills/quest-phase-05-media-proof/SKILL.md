---
name: quest-phase-05-media-proof
description: Execute QUEST Phase 05 — Media & Proof Engine. Invoke manually when the previous phase exit gates are complete.
disable-model-invocation: true
---

# QUEST Phase 05 — Media & Proof Engine

Before starting:
1. Read `CLAUDE.md`, `PROGRESS.md`, `BACKLOG.md`, `ARCHITECTURE_DECISIONS.md`, relevant ADRs and all files affected by this phase.
2. Confirm the previous phase exit gates from repository evidence; do not rely only on prose claims.
3. Use relevant project subagents and reusable skills. Keep specialist exploration out of the main context when it is large.
4. Work in small increments and run tests continuously.


Build secure evidence upload and verification orchestration.

Scope: pre-signed direct upload, media ownership, file size/type policies, malware/content scanning integration points, image/video metadata, processing state, evidence submission, deterministic validation, proof verification record, confidence/status, human-review routing, appeals/reconsideration primitives, retention/deletion.

Use `proof-verification` and `quest-safety`. AI may be stubbed behind the AI Gateway until Phase 06.

Required: upload threat model, privacy/consent, minors/location metadata handling, EXIF policy, replay/duplicate abuse tests, asynchronous media events/workers, failure recovery and observability.

## Mandatory closeout
- Run relevant typecheck/lint/tests/build and record results.
- Perform code review plus security/privacy/safety review appropriate to the phase.
- Update `PROGRESS.md`, `BACKLOG.md`, architecture/API/data docs and ADR index as applicable.
- List known debt and blockers explicitly.
- Do not start the next phase automatically.
