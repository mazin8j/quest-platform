# ADR-007 — NestJS for the backend API

## Status

Accepted (2026-09-04, Phase 00)

## Context

The modular monolith (ADR-001) needs a framework with first-class module boundaries, dependency injection for ports/adapters, mature middleware (validation, guards, interceptors, versioning) and a large TypeScript ecosystem, without becoming a magic-heavy platform.

## Decision

`apps/api` is a NestJS 12 application on Express. Cross-cutting concerns are wired once in `bootstrap.ts`/`app.module.ts`: validated config (`APP_CONFIG`, zod), pino structured logging with redaction, request/correlation-id middleware (AsyncLocalStorage), helmet, CORS allow-list, URI versioning (`/v1`), global throttler, the standard error envelope filter, and infrastructure ports (database, Redis, object storage, events, AI). Request validation uses **zod** via `ZodValidationPipe` so schemas are shared with clients contract-first (instead of class-validator).

## Alternatives Considered

- **Fastify + hand-rolled DI** — rejected: more glue code, weaker module conventions for a 20-context monolith.
- **Express only** — rejected: no DI/module system; boundaries would erode.
- **Hono/tRPC** — rejected: tRPC couples clients to TypeScript server types (mobile/web fine, but public/partner APIs and versioning suffer).
- **class-validator DTOs** — rejected in favour of zod: single validation library across API, web, mobile and packages.

## Consequences

- Positive: explicit modules, testable via `@nestjs/testing` with provider overrides, rich ecosystem (terminus, throttler, pino).
- Negative: decorator metadata requires SWC/tsc (Vitest uses `unplugin-swc`); Nest upgrades are periodic.
- Performance: Express is adequate for MVP; Fastify adapter remains a drop-in option.

## Revisit Triggers

p95 latency dominated by framework overhead, or a need for HTTP/2 streaming the Express adapter cannot meet.
