# 06 — API Architecture

The canonical contract document is [`docs/api/API_CONVENTIONS.md`](../api/API_CONVENTIONS.md).
This page records how the API application implements it.

- **Versioning**: URI versioning (`/v1/...`) via Nest `enableVersioning`; health endpoints are
  version-neutral (`/health`, `/ready`).
- **Contract-first schemas**: zod schemas in `@quest/types` (shared with clients) or next to the
  controller; `ZodValidationPipe` validates and strips unknown keys; validation failures render
  `VALIDATION_ERROR` with `issues[]`.
- **Error envelope**: `ApiExceptionFilter` renders every error (typed `ApiError`, Nest
  `HttpException`, body-parser errors, unknown exceptions) as `{ error: { code, message, issues?,
correlationId, timestamp } }`; 5xx details go to logs only.
- **Correlation**: `x-correlation-id` accepted (sanitised) or generated; `x-request-id` always
  generated; both echoed on every response and attached to logs and events.
- **Security**: helmet (CSP `default-src 'none'`, no framing, no referrer, HSTS in prod), CORS
  allow-list from config, JSON body limit 256 KB, `x-powered-by` disabled, `trust proxy 1`.
- **Rate limiting**: `@nestjs/throttler` global guard (window/limit from config, in-memory storage
  in Phase 00; Redis storage when scaling > 1 replica), health endpoints exempt, 429 rendered via envelope.
- **Authentication/authorization** (Phase 01): global `AuthGuard` with default deny, `@Public`
  opt-out, lifecycle-state and verified-email checks, permission checks from the shared RBAC
  vocabulary (`@quest/types`); tokens per ADR-011.
- **Documentation**: OpenAPI 3.1 generated from the zod contracts through a route registry
  (ADR-012) → `docs/api/openapi/v1.json`; a unit test fails when a registered route is undocumented
  or the committed document is stale. Endpoint guide: `docs/api/IDENTITY_API.md`.

Existing endpoints:

| Method | Path                                                                                 | Version | Auth                             | Purpose                                                              |
| ------ | ------------------------------------------------------------------------------------ | ------- | -------------------------------- | -------------------------------------------------------------------- |
| GET    | `/health`                                                                            | neutral | none                             | liveness                                                             |
| GET    | `/ready`                                                                             | neutral | none (network-restricted in AWS) | readiness with dependency checks                                     |
| GET    | `/v1/system/info`                                                                    | v1      | none                             | build metadata; proves versioning/envelope plumbing                  |
| —      | `/v1/auth/*`, `/v1/me/**`, `/v1/profiles/*`, `/v1/interests`, `/v1/admin/accounts/*` | v1      | per route (see OpenAPI)          | Phase 01 identity & profiles — 46 routes, `docs/api/IDENTITY_API.md` |
