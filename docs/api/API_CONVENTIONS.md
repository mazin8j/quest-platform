# QUEST API conventions (v1)

Implemented by `apps/api` (`ApiExceptionFilter`, `ZodValidationPipe`, `bootstrap.ts`) and the
shared contracts in `@quest/types`. Clients use `@quest/api-client`, which encodes these rules.

## Versioning

- URI prefix: `/v1/...`. Breaking changes create `/v2` for the affected resources; additive changes
  (new optional fields, new endpoints, new enum values) do not bump the version.
- Health endpoints are version-neutral: `GET /health`, `GET /ready`.
- Clients must tolerate unknown fields and unknown enum values (render as "unknown", never crash).

## Requests

- JSON only (`content-type: application/json`), max 256 KB. Media never transits the API — clients
  upload directly to object storage with a pre-signed URL obtained from the API (ADR-005).
- Every request carries `x-correlation-id` (client-generated, 8–128 chars `[A-Za-z0-9._:-]`); the
  server generates one if absent or malformed and always echoes `x-correlation-id` and `x-request-id`.
- Unsafe requests that may be retried (POST/PUT/PATCH/DELETE) send `idempotency-key`; endpoints
  document their idempotency behaviour (first mutating endpoints arrive in Phase 01).
- Validation: zod schemas; unknown keys are stripped; coercion only where the schema says so.

## Responses

- Success: `2xx` with the resource or collection as the body. No generic `{ data: … }` wrapper for
  single resources; collections use the pagination shape below. `201` for creation, `204` for
  deletion/no content.
- Timestamps: ISO-8601 UTC with milliseconds (`2026-09-04T18:20:11.123Z`). Identifiers: UUID strings.
- Enums: `SCREAMING_SNAKE_CASE` strings.

## Error envelope (every non-2xx)

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "issues": [{ "path": "title", "message": "Required", "code": "invalid_type" }],
    "correlationId": "journey-abc-12345",
    "timestamp": "2026-09-04T18:20:11.123Z"
  }
}
```

| Code                     | HTTP | When                                                                                                                            |
| ------------------------ | ---- | ------------------------------------------------------------------------------------------------------------------------------- |
| `VALIDATION_ERROR`       | 400  | schema/format failure (`issues[]` present) or malformed JSON                                                                    |
| `UNAUTHENTICATED`        | 401  | missing/invalid credentials                                                                                                     |
| `FORBIDDEN`              | 403  | authenticated but not permitted (authorization errors never reveal whether the resource exists beyond what the caller may know) |
| `NOT_FOUND`              | 404  | unknown route or resource                                                                                                       |
| `CONFLICT`               | 409  | uniqueness / state-transition conflict / idempotency-key reuse with different body                                              |
| `PAYLOAD_TOO_LARGE`      | 413  | body limit                                                                                                                      |
| `UNSUPPORTED_MEDIA_TYPE` | 415  | non-JSON content type                                                                                                           |
| `RATE_LIMITED`           | 429  | throttler; `retry-after` header                                                                                                 |
| `SERVICE_UNAVAILABLE`    | 503  | dependency down / readiness failure                                                                                             |
| `INTERNAL_ERROR`         | 500  | unexpected; message is generic, details only in logs                                                                            |

Codes are stable and additive. `message` is safe for developers, not for end users (clients
localise by `code`).

## Pagination, filtering, sorting

- Cursor pagination: `?cursor=<opaque>&limit=20` (max 100). Response:
  `{ "data": [...], "pageInfo": { "nextCursor": "…" | null, "hasMore": true } }`.
- Filtering: explicit, whitelisted query params per endpoint (`?status=ACTIVE&category=fitness`);
  no generic query languages.
- Sorting: `?sort=createdAt:desc,title:asc` with whitelisted fields (`sortQuerySchema`).
- Offset pagination only for small admin lists, documented per endpoint.

## Authorization

- Bearer tokens (`authorization: Bearer …`) from Phase 01; the API is the authority — clients only
  hide controls. Every endpoint declares its required permission; default deny.

## Rate limiting

- Global default from `RATE_LIMIT_*` config; stricter per-route limits for authentication, quest
  creation, reporting and invitations (declared per endpoint in later phases). Edge WAF rate rule
  as a backstop.

## Deprecation

- Deprecated fields/endpoints are announced in the changelog, marked in OpenAPI (Phase 01+), and
  kept for at least one mobile release cycle (≥ 90 days) before removal.
