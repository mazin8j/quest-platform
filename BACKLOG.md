# QUEST Backlog

## P0 — MVP

- Identity and profile
- Interests and onboarding
- Quest create/publish/discover
- Accept/start/complete Quest
- Photo/video proof
- Safety classification
- XP, levels, badges
- Quest Passport
- Friends/follows
- Comments/reactions/shares
- Challenge friends
- Nearby quests
- World Quest v1
- Notifications
- Admin moderation
- AI Quest Generator
- Basic personalization

## P1 — Growth

- Crews
- Quest chains
- Mystery Quest
- City/country competitions
- Creator Quest tools
- Referral attribution
- Advanced recommendation/ranking
- Enhanced proof verification

## P2 — Monetization

- Sponsored Quests
- Brand campaigns
- Creator monetization
- Quest+ subscription
- Corporate Quest
- Tourism/destination Quest packages

## Technical debt & foundation follow-ups (from Phase 00, 2026-09-04)

### Must do in the phase that first needs it

- TD-01 Transactional outbox for domain events before the first cross-process consumer (Phase 05 at
  the latest); EventBridge publisher adapter + SQS consumer runtime (same image, worker entrypoint).
- TD-02 Redis-backed `@nestjs/throttler` storage before running > 1 API replica.
- TD-03 ~~OpenAPI generation from zod schemas~~ — DONE in Phase 01 (ADR-012, drift-checked in CI).
- TD-04 OpenTelemetry NodeSDK preload (`OTEL_ENABLED=true`) + ADOT collector sidecar with the first
  deployed environment; `MetricsPort` implementation over the OTel meter.
- TD-05 Deploy workflow (build/push image to ECR, `terraform plan` on PR, gated `apply`) once an AWS
  account and remote-state bucket exist; assemble `DATABASE_URL`/`REDIS_URL` from outputs + RDS secret.
- TD-06 Component tests for mobile (jest-expo or RNTL) and web/admin with the first real screens.
- TD-07 ~~Account export/deletion cascade design + `identity.account.deleted` handlers~~ — DONE in
  Phase 01 (`docs/data/IDENTITY_DATA_MODEL.md`); every later context must add its own handler +
  `DataExportContributor` when it adds account-linked tables (checked at each phase gate).
- TD-08 EXIF/location metadata policy for evidence before any media is stored (Phase 05).

### Phase 01 follow-ups (Identity & Profiles, 2026-09-06)

- TD-21 **Transactional mail delivery provider** (SES or vendor, region-compliant) behind
  `MailerPort` before any public sign-up; today the `log` adapter only prints redacted delivery
  lines. Also: scheduled worker for `identity:process-deletions` / `identity:process-exports` /
  session purge with the first deployment (TD-05).
- TD-22 Redis-backed session cache for the per-request session/roles lookup once sign-in p95 or
  database load says so (ADR-011 revisit trigger).
- TD-23 MFA / passkeys (WebAuthn adapter on `account_credential`), staff MFA first.
- TD-24 Admin console: transparent access-token refresh via a route handler/middleware (today a
  staff session lasts one access-token TTL and the console keeps no refresh token) + automated
  tests for `getStaffContext` and the sign-in handler.
- TD-25 Credential abuse hardening: breached-password (k-anonymity) check behind a port; per
  (account, IP) exponential backoff instead of a hard account lock (lockout is a cheap targeted
  DoS today — threat T22); "someone tried to sign in" notice with self-unlock.
- TD-26 Retention jobs: `identity_audit_ledger` aggregation after 24 months, expired-session purge
  (`purgeExpiredSessions`), expired export objects (lifecycle rule exists; sweep in `processOpen`).
- TD-27 Mobile: Apple/Google native sign-in buttons (API adapters are complete), avatar upload UI
  over the existing pre-signed flow, RN component rendering tests (TD-06).
- TD-28 Refresh-token reuse detection covers one generation back; keep a bounded history of used
  token hashes per session so any historical replay trips the theft signal.

### Phase 01 gate-audit follow-ups (2026-09-06, `docs/governance/PHASE_GATE_AUDIT_PHASE_01_2026-09-06.md`)

- TD-29 `privacy_settings.discoverable` is stored, defaulted and locked for 13–15 year-olds but no
  read path consults it yet — the first search / suggestion surface (Phase 03) must honour it, and
  `GET /v1/profiles/username-availability` stays an existence oracle until then (P01-A2).
- TD-30 OIDC `nonce` binding: id_tokens are accepted for 5 minutes (`maxTokenAge`) but the client
  does not yet send back the nonce it used, so a captured token is replayable within that window;
  add single-use server-side nonces with the native sign-in buttons (TD-27). `OidcIdentityProvider`
  also has no automated test — add one against a locally minted JWKS (P01-A5).
- TD-31 Staff-account rectification: no endpoint can correct a mistyped date of birth, so an adult
  band derived from a wrong DOB is permanent (GDPR Art. 16). Add an audited `MANAGE_STAFF` endpoint
  that re-derives the band and re-applies `privacyDefaultsFor` (P01-A6).
- TD-32 `GET /v1/me/blocks` joins the blocked account's **current** username, so the list is an
  accountId → handle oracle for private profiles. Snapshot the handle at block time (schema change)
  or hide it for non-visible profiles (P01-A7).
- TD-33 Export/deletion workers claim work with a read-then-update rather than
  `UPDATE … RETURNING` / `SELECT … FOR UPDATE SKIP LOCKED`; two runners could process the same
  request. Harmless with the single CLI runner, mandatory before a scheduled multi-replica worker
  (P01-A8). Same for the 24-hour export interval, which has no unique-index backstop.
- TD-34 Consent ledger append-only is a code convention: no DB trigger or `REVOKE UPDATE/DELETE`
  prevents a future service from rewriting the legal record (P01-A9).
- TD-35 Legal review of the global minimum age (13) against jurisdictions that set the digital age
  of consent at 14–16 (GDPR Art. 8), plus a trustworthy country signal to key regional policy on;
  `deriveAgeBand` is the single seam that would take it (P01-A10).
- TD-36 The rate-limit metadata published in the OpenAPI registry is not asserted against the
  `@Throttle` decorators; add a drift test so documented and enforced limits cannot diverge
  (P01-A11).

### Should fix

- TD-17 **Audit risk acceptance (expires 2026-12-01)**: `image-size <=2.0.2` (GHSA-w3rx-r6r6-pgpr,
  GHSA-5p2g-fcmc-qvqq) ignored in `pnpm-workspace.yaml` `auditConfig.ignoreGhsas` — reached only via
  Expo/Metro dev tooling, no upstream patch. Re-evaluate at Expo SDK 58 or by the expiry date; remove
  the ignore as soon as a patched transitive version ships.
- TD-18 Web/admin CSP `connect-src` omits the API origin when `NEXT_PUBLIC_API_BASE_URL` is unset at
  build time (env module defaults to localhost:4000). Harmless while all API calls are server-side;
  align before the first client-side fetch.
- TD-19 Rate-limit envelope message carries the framework prefix (`ThrottlerException: …`); map to a
  contract message and assert `retry-after` in the rate-limit test.

- TD-09 Upgrade ESLint 9 → 10 when `eslint-config-next` supports it (blocked: `react/display-name`
  rule incompatible with ESLint 10 core API).
- TD-10 ~~Add `docs/ux` with the first UX deliverable~~ (done: `docs/ux/PHASE_01_MOBILE_ONBOARDING.md`);
  the cross-layer E2E suite lives in `apps/api/test/e2e` (SDK ↔ live API ↔ DB) — move under `tests/`
  only when a multi-app runner (device + web) is needed.
- TD-11 Confirm `me-central-1` service availability for each newly adopted managed service; revisit
  ADR-008 triggers quarterly.
- TD-12 Add `terraform validate` results from the first CI run to `PROGRESS.md` (sandbox could not
  reach provider registries).
- TD-13 Consider `PriceClass_All` for CloudFront if MENA edge coverage under `PriceClass_200` proves
  insufficient (measure p95 from Amman/Riyadh/Dubai).

### Nice to have

- TD-20 Pin GitHub Actions to full commit SHAs (with version comments) via Dependabot/Renovate-managed
  updates once the repository's supply-chain policy formally requires it; today the convention is
  release tags (`checkout@v6`, `setup-node@v7`, `pnpm/action-setup@v6`, `setup-terraform@v4`,
  `trufflehog@v3.97.4`).

- TD-14 Turborepo remote cache for CI speed.
- TD-15 Renovate/Dependabot configuration for grouped dependency updates with Expo SDK awareness.
- TD-16 `docs/architecture` diagrams exported as images for non-Mermaid viewers.
