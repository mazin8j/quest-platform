---
name: quest-phase-01-identity
description: Execute QUEST Phase 01 — Identity & Profiles. Invoke manually when the previous phase exit gates are complete.
disable-model-invocation: true
---

# QUEST Phase 01 — Identity & Profiles

Before starting:
1. Read `CLAUDE.md`, `PROGRESS.md`, `BACKLOG.md`, `ARCHITECTURE_DECISIONS.md`, relevant ADRs and all files affected by this phase.
2. Confirm the previous phase exit gates from repository evidence; do not rely only on prose claims.
3. Use relevant project subagents and reusable skills. Keep specialist exploration out of the main context when it is large.
4. Work in small increments and run tests continuously.


Implement the first secure vertical slice for account onboarding and profiles.

Scope: registration/authentication adapter, session/token handling, username/display profile, avatar reference, language/country/timezone, interest selection, privacy defaults, age/date-of-birth handling suitable for future age gating, account status, profile read/update, device registration for future notifications.

Do not build social graph yet.

Required: product acceptance criteria; threat model; privacy classification; data model/migrations; API contract; mobile onboarding/profile UX; admin support fields only where needed; unit/integration/E2E tests; rate limiting and abuse controls; telemetry.

Use adapters for Apple/Google/identity provider integration so local/dev testing does not depend on production credentials.

Exit: a new user can securely onboard, select interests, create/update a profile, sign out/in, and exercise privacy controls with automated tests.

## Mandatory closeout
- Run relevant typecheck/lint/tests/build and record results.
- Perform code review plus security/privacy/safety review appropriate to the phase.
- Update `PROGRESS.md`, `BACKLOG.md`, architecture/API/data docs and ADR index as applicable.
- List known debt and blockers explicitly.
- Do not start the next phase automatically.
