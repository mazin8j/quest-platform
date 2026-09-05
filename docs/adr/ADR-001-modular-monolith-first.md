# ADR-001 — Modular monolith first

## Status

Accepted (2026-09-04, Phase 00)

## Context

QUEST spans ~20 bounded contexts (identity, quest, participation, proof, social, crews, feed, discovery, gamification, notifications, location, creators, brands, world quest, trust & safety, moderation, analytics, AI). A small team must ship an MVP quickly while keeping the option to scale specific hot paths (media processing, feed, counters) independently later. Microservices from day one would multiply deployment units, network failure modes, data-consistency problems and operational cost before any traffic exists.

## Decision

Build one deployable NestJS application (`apps/api`) organised as strictly bounded domain modules under `apps/api/src/modules/<context>/`, each with `api/`, `application/`, `domain/`, `ports/`, `infrastructure/` and a single public `index.ts`. Cross-module interaction happens only through exported ports (synchronous reads) and domain events (asynchronous reactions). The boundaries are enforced mechanically by `.dependency-cruiser.cjs` (`pnpm deps:check`, CI-blocking), not by convention alone. Async workers run the same codebase with a different entrypoint.

## Alternatives Considered

- **Microservices per context** — rejected: premature; no scaling evidence; multiplies infra and on-call surface.
- **Unstructured monolith** — rejected: boundaries erode within weeks without tooling; extraction later becomes a rewrite.
- **Serverless functions per endpoint** — rejected: poor fit for stateful domain logic, connection pooling to PostgreSQL, and local developer experience.

## Consequences

- Positive: one build, one deploy, one database transaction boundary per use case; simple local dev; refactoring across contexts is cheap.
- Negative: a bad deploy affects every context; a runaway module can starve others (mitigated by autoscaling and per-route rate limits); team discipline required (mitigated by lint/depcruise gates).
- Operational: single ECS service + optional worker service; horizontal scaling of the whole unit.
- Security/privacy: single trust boundary; RBAC and data classification must be enforced inside modules.

## Revisit Triggers

Extract a module into a service only when one of the documented triggers in `docs/architecture/13_SCALABILITY_ARCHITECTURE.md` is met with evidence: sustained independent-scaling need, distinct SLO/availability requirement, regulatory isolation, team deployment autonomy, or blast-radius reduction justified by an incident.
