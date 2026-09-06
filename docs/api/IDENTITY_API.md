# Identity & Profiles API (v1)

Machine-readable contract: `docs/api/openapi/v1.json` (generated from `@quest/types`, ADR-012;
`pnpm --filter @quest/api openapi:generate`). Conventions: `API_CONVENTIONS.md`. Client SDK:
`@quest/api-client` `identityApi()` + `AuthSession` (transparent refresh, single-flight).

## Authentication model

- `Authorization: Bearer <accessToken>` (HS256 JWT, 15 min). Refresh with `POST /v1/auth/refresh`
  using the opaque refresh token; **every refresh returns a new refresh token and invalidates the
  previous one**. Presenting an old refresh token revokes the whole session (401) — clients must
  never retry a refresh with a stale token (use `AuthSession`).
- Every route is authenticated unless listed as public. Responses: 401 `UNAUTHENTICATED` (no/invalid
  token or revoked session), 403 `FORBIDDEN` (state, unverified email or missing permission — the
  message says which), 429 `RATE_LIMITED` with `retry-after`.
- Account states allowed by default: `ACTIVE`, `PENDING_VERIFICATION`. Routes that also work while
  `DELETION_REQUESTED`: `GET /me`, consents (read), deletion status/cancel, sign-out.

## Endpoints

| Area    | Method & path                                        | Auth / notes                                                                                        |
| ------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| auth    | `POST /v1/auth/register`                             | public · 5/min · 201 `AuthResponse`; 403 under-age; 409 email exists; consent versions must match   |
| auth    | `POST /v1/auth/login`                                | public · 10/min · one generic 401 for every failure; lockout after N failures                       |
| auth    | `POST /v1/auth/provider/sign-in`                     | public · `provider` APPLE/GOOGLE/FAKE · 404 when the identity is unknown (run register)             |
| auth    | `POST /v1/auth/provider/register`                    | public · requires DOB + consents · provider must assert a verified email                            |
| auth    | `POST /v1/auth/refresh`                              | public · rotation + reuse detection                                                                 |
| auth    | `POST /v1/auth/logout` / `logout-all`                | any state incl. deletion grace                                                                      |
| auth    | `POST /v1/auth/email/verify` / `resend`              | verify moves `PENDING_VERIFICATION → ACTIVE`; resend 3/5 min + 60 s cooldown (409)                  |
| auth    | `POST /v1/auth/password/change`                      | re-auth with current password; revokes other sessions; 204                                          |
| auth    | `POST /v1/auth/password/forgot` / `reset`            | public · forgot always 202 · reset revokes all sessions                                             |
| account | `GET /v1/me`                                         | `AccountView` (id, email, verified, state, ageBand, roles, onboarding, deletionScheduledFor)        |
| account | `GET/DELETE /v1/me/sessions[/:id]`                   | `MANAGE_OWN_SESSIONS`                                                                               |
| account | `GET/POST/DELETE /v1/me/devices[/:id]`               | `MANAGE_OWN_DEVICES` · push tokens accepted, never returned                                         |
| account | `GET /v1/me/consents[/history]`, `POST`              | `MANAGE_OWN_ACCOUNT` · document consents cannot be withdrawn; `requiresReprompt` when versions bump |
| account | `POST /v1/me/deactivate`                             | `ACTIVE` only · 204 · sign-in reactivates                                                           |
| account | `POST/GET /v1/me/deletion-request`, `POST …/cancel`  | `REQUEST_OWN_DELETION` · password re-auth · 30-day grace                                            |
| account | `POST/GET /v1/me/data-export[/:id]`                  | `REQUEST_OWN_DATA_EXPORT` · verified email · 24 h interval · pre-signed download while READY        |
| profile | `GET/PUT /v1/me/profile`                             | `MANAGE_OWN_PROFILE` · partial update · 409 username taken · avatar key must be uploaded first      |
| profile | `POST /v1/me/profile/avatar-upload`                  | verified email · pre-signed PUT (jpeg/png/webp ≤ 5 MB) under `avatars/<accountId>/`                 |
| profile | `GET/PUT /v1/me/interests`                           | keys validated against the catalogue; ≤ 20                                                          |
| profile | `GET /v1/me/onboarding`, `POST …/complete`           | completion needs verified email, username, display name, ≥ 3 interests (400 lists what's missing)   |
| privacy | `GET/PUT /v1/me/privacy`                             | `MANAGE_OWN_PRIVACY` · age-band policy → 403 names the field · `lockedByPolicy` for UI              |
| privacy | `GET/POST/DELETE /v1/me/blocks[/:accountId]`         | `MANAGE_OWN_BLOCKS` · symmetric precedence                                                          |
| public  | `GET /v1/interests`                                  | catalogue                                                                                           |
| public  | `GET /v1/profiles/username-availability?username=`   | 30/min · `RESERVED` / `TAKEN` / `INVALID`                                                           |
| public  | `GET /v1/profiles/:username`                         | 60/min · limited card for non-PUBLIC; 404 for hidden/blocked/inactive/unknown                       |
| admin   | `GET /v1/admin/accounts/:id`                         | `VIEW_USER_SUPPORT_PROFILE` · support view (no DOB)                                                 |
| admin   | `POST /v1/admin/accounts/:id/suspend` / `reinstate`  | `SANCTION_USER` · attributed to the staff actor                                                     |
| admin   | `POST /v1/admin/accounts/:id/roles` / `roles/revoke` | `MANAGE_STAFF` (SUPER_ADMIN) · revocation revokes the target's sessions                             |

## Validation rules not expressible in JSON Schema

- Email is trimmed and lower-cased before validation; uniqueness is case-insensitive among live accounts.
- Password: 10–128 chars, not in the common-password list, not a single repeated character, must not contain the email local part (≥ 4 chars).
- Date of birth: valid calendar date, not in the future, ≤ 120 years; band `UNDER_MINIMUM` (< 13) is refused with 403.
- Username: trimmed, lower-cased, `^[a-z](?:[a-z0-9]|_(?=[a-z0-9])){2,29}$`, not reserved.
- Time zone must exist in the runtime's Intl database; country is ISO 3166-1 alpha-2; language is BCP-47.
- Consent document versions must equal `AUTH_TERMS_VERSION` / `AUTH_PRIVACY_POLICY_VERSION`.

## Idempotency

`PUT` routes are idempotent by definition. `POST /auth/register` is not idempotent (409 on retry after success); clients keep the response tokens. `POST /me/blocks` and role grants are idempotent (no-op when already present). `POST /me/onboarding/complete` is idempotent.
