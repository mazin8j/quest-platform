---
name: api-contract
description: Use when creating or changing QUEST APIs, DTOs, public schemas, errors, pagination, or authentication behavior.
---

# api-contract

## Use when

Use when creating or changing QUEST APIs, DTOs, public schemas, errors, pagination, or authentication behavior.

## Inputs

Resource/use case, actor and permission, request/response fields, error cases, idempotency and pagination needs; `docs/api/API_CONVENTIONS.md`; `@quest/types`.

## Workflow

1. Write zod request/response schemas (shared in `@quest/types` when clients need them).
2. Declare route/version, authorization (default deny), error codes, idempotency, pagination/sort whitelist, rate limit.
3. Implement controller → application service; render errors via `ApiError`.
4. Add API tests: success, validation failure, authorization failure, idempotent retry, pagination edge.
5. Document in `docs/api/` (and OpenAPI once available).

## Guidance

Design API changes contract-first. Define route/version, authz, request schema, response schema, stable error codes, idempotency behavior, pagination, rate limits, observability, compatibility, and API tests. Never expose internal ORM objects directly.

## Constraints

Never expose ORM/DB rows directly; additive changes only within a version; correlation id and envelope conventions are mandatory.

## Done when / Exit criteria

Schemas, route, tests and docs exist; contract matches `API_CONVENTIONS.md`; `pnpm verify` green.
