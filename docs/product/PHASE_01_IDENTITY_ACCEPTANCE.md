# Phase 01 — Identity & Profiles: requirement gate (G0) and acceptance criteria

Status: implemented 2026-09-06 on branch `phase-01-identity`; verified by the automated suites named
under each criterion (`apps/api/test/integration/identity.int.test.ts` = INT,
`apps/api/test/e2e/onboarding-journey.e2e.test.ts` = E2E, unit tests = UNIT).

## User value

A person can create a QUEST account safely on a phone, prove they control their email, set up a
public identity (username, display name, avatar, interests), control who sees what, and leave
QUEST (deactivate, export, delete) without asking support. Staff can help a user without seeing
more than they need. Everything later (quests, proof, social graph) hangs off an immutable account
id that never changes when a user renames or changes email.

## Success metrics (instrumented through the MetricsPort, dashboards in the release gate)

- Registration → email verified within 24 h ≥ 80 % (`quest.identity.registered`, `quest.identity.email_verified`).
- Onboarding completion (verify → profile → ≥ 3 interests) ≥ 60 % of verified accounts (`quest.profiles.onboarding_completed`).
- Sign-in failure rate excluding lockouts ≤ 5 % (`quest.identity.login{result}`).
- Zero credential-stuffing success: lockout events observed while `result=ok` from the same key stays flat.

## Out of scope (explicitly not built)

Social graph (follows, mutes), quests, feed, XP/badges, creators/brands, AI features, MFA/passkeys,
phone-number identity, parental controls, regional age-of-consent overrides, notification delivery
(devices are registered; nothing is sent), real mail delivery provider, staff MFA.

## Acceptance criteria

| #   | Criterion                                                                                                                                                    | Evidence                                             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| A1  | Register with email + password + DOB + consents → 201, account `PENDING_VERIFICATION`, immutable UUID v7 id, tokens issued, consent ledger written           | INT "registers a new account…"                       |
| A2  | Duplicate email (case-insensitive) → 409; weak/common password → 400 with field issue; outdated consent versions → 400; under-13 → 403 and nothing stored    | INT "refuses duplicate emails…"                      |
| A3  | Email verification with the mailed 6-digit code; wrong code → 400; success → `ACTIVE`; onboarding cannot complete before verification (403)                  | INT "verifies the email…"                            |
| A4  | Username rules (3–30, lowercase, reserved list), live availability, uniqueness under concurrency → 409                                                       | INT "enforces username uniqueness…", UNIT types      |
| A5  | Interest catalogue (≥ 20 seeded), selection validated against the catalogue, ≥ 3 required to complete onboarding; completion is idempotent                   | INT "verifies the email…"                            |
| A6  | Privacy settings with age-band defaults; adults free, 16–17 may not reveal location below city, 13–15 locked private/hidden/non-discoverable → 403 on change | INT "applies the minor policy…"                      |
| A7  | Public profile respects visibility (PRIVATE/FOLLOWERS → limited card), hides inactive/unverified/deleted accounts (404) and never returns email or DOB       | INT "applies adult privacy defaults…"                |
| A8  | Blocking is symmetric and precedes every read (404 both ways); self-block refused; unblock restores                                                          | INT, E2E                                             |
| A9  | Refresh rotation; reuse of a rotated token revokes the session incl. the fresh access token; sessions list/revoke; sign-out invalidates access + refresh     | INT "rotates refresh tokens…"                        |
| A10 | Unknown email and wrong password are indistinguishable; lockout after N failures blocks even the correct password; per-client rate limit → 429               | INT "answers unknown emails…", "rate limits sign-in" |
| A11 | Change password (re-auth) revokes other sessions; forgot/reset always 202, code single-use, reset revokes all sessions                                       | INT "changes and resets passwords…"                  |
| A12 | Provider sign-in/registration through the adapter port (FAKE locally); unknown identity → 404; unverified provider email → 400; duplicate link → 409         | INT "signs up and in through the provider adapter…"  |
| A13 | Consent history is append-only with current state + reprompt detection; terms/privacy cannot be withdrawn; age attestation only at registration              | INT "keeps an append-only consent history…"          |
| A14 | Devices register with push tokens that are never returned; avatar uploads are pre-signed, bound to the account, and validated as uploaded before use         | INT "registers devices…"                             |
| A15 | Deactivate hides the profile and revokes sessions; sign-in reactivates                                                                                       | INT "deactivates and reactivates…"                   |
| A16 | Deletion request needs the password, schedules a 30-day grace, hides the profile, is cancellable; the job anonymises the account and cascades to profiles    | INT "requests, cancels and finally executes…"        |
| A17 | Data export produces one JSON bundle with a section per context, downloadable via short-lived URL, never containing hashes/tokens; one request per 24 h      | INT "produces a downloadable data-export bundle…"    |
| A18 | RBAC: support view without DOB for `VIEW_USER_SUPPORT_PROFILE`; suspend/reinstate for `SANCTION_USER`; roles for `MANAGE_STAFF` only; role loss is immediate | INT "enforces RBAC…", UNIT auth-guard                |
| A19 | Every route is authenticated by default; `@Public` is explicit; state/verified-email/permission checks are enforced by one guard                             | UNIT auth-guard, validation ("default deny")         |
| A20 | The client SDK completes the whole journey against a live server (sign up → verify → profile → interests → privacy → sign out/in → block → export)           | E2E                                                  |
| A21 | Every registered HTTP route is documented in the OpenAPI document and the committed document matches the generated one                                       | UNIT openapi                                         |
| A22 | Mobile app: sign-up, sign-in, verify, profile, interests, privacy, account/sessions, deletion-pending screens; routing derived from the server account view  | UNIT mobile (routing/store), Metro export            |
