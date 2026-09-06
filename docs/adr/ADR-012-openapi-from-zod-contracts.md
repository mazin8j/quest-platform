# ADR-012 — OpenAPI generated from zod contracts

## Status

Accepted (2026-09-06, Phase 01)

## Context

ADR-007 and ADR-009 make zod schemas in `@quest/types` the single source of truth for request and response shapes (contract-first). Phase 01 introduces the first resource endpoints and BACKLOG TD-03 requires an OpenAPI document with them. The document must never drift from the implementation, must not require a second hand-written schema, and must be diffable in pull requests.

## Decision

- A **route registry** (`apps/api/src/openapi/routes.ts`) lists every HTTP route with method, path, tag, summary, auth requirement (public or required permissions), allowed account states, verified-email requirement, request/query/response zod schemas and per-route rate limit.
- `apps/api/src/openapi/build-openapi.ts` derives an OpenAPI 3.1 document from the registry using zod 4's built-in `z.toJSONSchema` (draft 2020-12, input mode). Custom `x-quest-*` extensions carry permissions, account states, verified-email and rate-limit metadata.
- `pnpm --filter @quest/api openapi:generate` writes `docs/api/openapi/v1.json` (excluded from Prettier so the output is byte-exact).
- A unit test (`src/openapi/openapi.test.ts`) boots the application, reads the Express router and fails when any registered route is missing from the registry or documented without existing, and when the committed document differs from the generated one. Drift therefore fails CI.

## Alternatives Considered

- **`@nestjs/swagger` decorators** — rejected: duplicates every shape as decorator metadata, diverges from zod, weak with zod-inferred DTOs.
- **`zod-openapi` / `@asteasolutions/zod-to-openapi`** — viable, but zod 4 now ships JSON Schema conversion natively; fewer dependencies and no registry-of-schemas boilerplate.
- **Hand-written OpenAPI** — rejected: guaranteed drift.

## Consequences

- Positive: one source of truth, mechanical drift detection, clients can generate SDK types from the document later, security metadata is reviewable per route.
- Negative: the registry is maintained by hand (the test makes forgetting impossible); zod features without a JSON Schema equivalent (transforms, refinements) appear as plain types — refinements are documented in prose in `docs/api/IDENTITY_API.md`.

## Revisit Triggers

- Client SDK generation from OpenAPI becomes a build step (evaluate emitting `components.schemas` with `$ref`s instead of inline schemas).
- More than ~150 routes (evaluate deriving the registry from controller metadata automatically).
