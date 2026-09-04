---
name: quest-phase-00-foundation
description: Execute QUEST Phase 00 — Foundation & Architecture. Invoke manually when the previous phase exit gates are complete.
disable-model-invocation: true
---

# QUEST Phase 00 — Foundation & Architecture

Before starting:
1. Read `CLAUDE.md`, `PROGRESS.md`, `BACKLOG.md`, `ARCHITECTURE_DECISIONS.md`, relevant ADRs and all files affected by this phase.
2. Confirm the previous phase exit gates from repository evidence; do not rely only on prose claims.
3. Use relevant project subagents and reusable skills. Keep specialist exploration out of the main context when it is large.
4. Work in small increments and run tests continuously.


Goal: create the implementation-ready project foundation without feature development.

Required work:
- Read CLAUDE.md, roadmap, backlog and target architecture.
- Invoke/use chief-architect, security-architect, trust-safety-architect, data-architect, devops-engineer and qa-engineer perspectives.
- Create the monorepo skeleton for apps/mobile, apps/web, apps/admin, apps/api, shared packages, infrastructure and tests.
- Establish workspace/package management, TypeScript base configuration, linting/formatting, test framework, commit-safe environment examples and Docker Compose for PostgreSQL + Redis + S3-compatible local storage.
- Create architecture documents: system context, containers, components, deployment, data, event, AI, security, trust/safety, observability and scalability.
- Create ADR-001 through ADR-008 or replace proposed decisions with better justified choices.
- Define domain boundaries and dependency rules.
- Define API error envelope and event envelope.
- Establish CI workflow for typecheck, lint, unit tests, integration-test prerequisites and build.
- Establish Terraform directory/modules and an initial AWS environment design, but do not deploy production resources unless explicitly asked.
- Define secrets/config strategy and environment separation.
- Produce a first database conceptual model but avoid premature schema detail for later phases.
- Update PROGRESS.md and ARCHITECTURE_DECISIONS.md.

Exit gates:
- repository installs/builds cleanly
- local services can be started reproducibly
- tests have a working baseline
- no feature/business implementation has been prematurely added
- architecture/security/safety reviews contain no unresolved blockers

At completion, provide: files created/changed, decisions made, commands to verify locally, open risks, and recommendation whether Phase 01 may start.

## Mandatory closeout
- Run relevant typecheck/lint/tests/build and record results.
- Perform code review plus security/privacy/safety review appropriate to the phase.
- Update `PROGRESS.md`, `BACKLOG.md`, architecture/API/data docs and ADR index as applicable.
- List known debt and blockers explicitly.
- Do not start the next phase automatically.
