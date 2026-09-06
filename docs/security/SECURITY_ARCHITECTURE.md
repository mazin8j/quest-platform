# QUEST security architecture (Phase 00 baseline)

Status legend: **Implemented** (code/tests exist), **Defined** (contract/infra code exists, not yet exercised), **Planned** (phase noted).

## Secure configuration & secrets

- **Implemented**: single validated config (`apps/api/src/config/app-config.ts`, zod); the process
  refuses to start on invalid config; production rules: `DATABASE_SSL=true`, no debug/trace logs,
  no local S3 endpoint; S3 credentials must be set together; AI model required if a provider is set.
- **Implemented**: `.env.example` contains local-only defaults; `.gitignore` excludes `.env*`,
  tfstate, tfvars; `redactSecrets()` helper for any config echo.
- **Defined**: Terraform `secrets` module creates Secrets Manager containers only; RDS master
  secret is RDS-managed; ECS execution role may read only the ARNs injected into the task.
- **Implemented (Phase 01)**: access-token signing key `AUTH_JWT_SECRET` (≥ 32 chars) with
  zero-downtime rotation: set the new value in `AUTH_JWT_SECRET`, move the old one to
  `AUTH_JWT_SECRET_PREVIOUS`, deploy, and drop `_PREVIOUS` after one access-token TTL (15 min).
  Dev-only switches (`AUTH_FAKE_PROVIDER_ENABLED`, `AUTH_DEV_EXPOSE_CODES`, `MAIL_PROVIDER=memory`)
  are refused by configuration in production — tested.

## Transport, headers, CORS

- **Implemented**: helmet on the API (CSP `default-src 'none'`, `frame-ancestors 'none'`,
  `X-Content-Type-Options`, `Referrer-Policy: no-referrer`, HSTS in production, CORP same-site);
  Next.js security headers on web (CSP, XFO DENY, Permissions-Policy) and stricter on admin
  (no-referrer, noindex). CORS allow-list from `CORS_ALLOWED_ORIGINS`; no wildcard with credentials.
- **Defined**: ALB TLS 1.3 policy, HTTP→HTTPS redirect when a certificate is present, CloudFront
  `redirect-to-https`/`https-only`, RDS `force_ssl`, Redis in-transit encryption required, S3
  TLS-only bucket policy.

## Input validation & injection

- **Implemented**: zod validation pipe with unknown-key stripping; body limit 256 KB; malformed
  JSON → `VALIDATION_ERROR`; Drizzle parameterised queries; object keys validated against a strict
  pattern (no traversal, no `//`, lowercase, bounded length) — tested.
- **Implemented (Phase 01)**: every identity/profile route validates body, params and query with
  zod schemas from `@quest/types`; the admin console validates form input with the same schemas;
  usernames/display names/bios exclude control and format characters.

## Authentication & authorization

- **Implemented (Phase 01, ADR-011)**: Argon2id password credentials with lockout; OIDC identity
  adapters (Apple/Google) + a local `FAKE` adapter; HS256 access tokens (15 min, session-bound) and
  opaque rotating refresh tokens with reuse detection; per-request session validation so
  revocation is immediate; device registration; email verification and password reset codes;
  global default-deny `AuthGuard` with lifecycle-state, verified-email and permission checks;
  roles ledger with `MANAGE_STAFF` only for `SUPER_ADMIN`; the admin console reuses the same
  `Role`/`Permission` vocabulary as its presentation gate and keeps staff tokens in httpOnly
  cookies. Threat model: `IDENTITY_THREAT_MODEL.md`. All of it is covered by the identity
  integration suite and the guard unit suite.
- **Rule**: authorization errors never disclose existence beyond what the caller may know.

## Rate limiting & abuse

- **Implemented**: global throttler (config-driven, 429 envelope, health exempt) — tested;
  per-route limits on every authentication and abuse-prone route (register 5/min, login 10/min,
  codes 3–10 per window, profile reads 60/min …) plus account-level lockout, code attempt caps,
  session cap and export/deletion intervals — tested.
- **Defined**: WAF rate-based rule and AWS managed rule groups at the edge.
- **Planned**: Redis-backed throttler storage when > 1 replica; per-route limits for auth, quest
  creation, reporting, invitations; abuse heuristics per phase.

## Audit logging

- **Implemented**: structured logs with request/correlation ids and actor id (set by the
  `AuthGuard`); `identity_audit_ledger` records sign-in outcomes, lockouts, token refresh/reuse,
  revocations, verification, password changes, lifecycle changes, role grants/revocations and
  staff actions with the acting `actor_id`; safety assessments and AI invocation records are
  append-only data structures by contract.
- **Planned**: moderator/admin action log table (Phase 03/14); export of audit trails.

## Encryption expectations

At rest: RDS storage encryption (KMS), S3 SSE-S3 or KMS, ElastiCache at-rest, Secrets Manager KMS,
CloudWatch Logs optional KMS. In transit: TLS everywhere including internal (RDS force_ssl, Redis
TLS). Application-level encryption for `RESTRICTED` fields (precise location history, identity
documents if ever collected) is decided per field in the phase that introduces it.

## Secure file upload architecture (ADR-005)

Pre-signed PUT bound to key/content-type/max size (≤ 1 h TTL); bucket private with public-access
block, versioning, lifecycle expiry for unattached uploads; CORS restricted to app origins;
delivery via CloudFront OAC; scanning/transcoding workers (Phase 05) quarantine until clean; EXIF
policy defined in Phase 05 before any evidence is stored.

## Dependency & secret scanning

CI: `pnpm audit --audit-level=high` fails the build. Exceptions are allowed only through
`auditConfig.ignoreGhsas` in `pnpm-workspace.yaml`, each with a comment stating reachability
(runtime vs dev tooling), the absence of a patched version, and an expiry date tracked in
`BACKLOG.md` (currently TD-17). TruffleHog scans history for verified secrets;
`pnpm install --frozen-lockfile` prevents drift; hoisted layout mitigated by dependency-cruiser and
explicit `dependencies`.

## Sensitive-log restrictions

pino redaction of `authorization`, `cookie`, `x-api-key`, `set-cookie`, `*.password|secret|token|apiKey`;
request bodies are not logged; readiness reports error codes only; never log precise location or
evidence keys alongside user identifiers; AI prompts are hashed unless a task opts in with retention.

## Threat model (initial)

| Threat                            | Mitigation                                                                                                                                  |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Credential stuffing / brute force | per-route rate limits, per-account lockout, generic errors, Argon2id (implemented); MFA (TD-23) and breached-password check (TD-25) pending |
| Token theft on device             | secure storage only, 15-min TTL, refresh rotation with reuse detection revoking the session, per-request session validation (implemented)   |
| Direct-to-origin bypass of WAF    | ALB forwards only with CloudFront shared-secret header                                                                                      |
| Malicious uploads                 | size/type-bound presign, scanning, private bucket, no execution                                                                             |
| Prompt injection via user content | gateway input minimisation, structured outputs, no tool use with side effects, human review for high risk                                   |
| Insider/admin misuse              | least-privilege roles, audit log, `MANAGE_STAFF` restricted                                                                                 |
| Dependency compromise             | audit gate, lockfile, allow-listed build scripts (`onlyBuiltDependencies`)                                                                  |
