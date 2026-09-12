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

### Phase 02 follow-ups (Quest core, 2026-09-07)

Residual items from the Phase 02 adversarial review. Every P0 and P1 was repaired on the branch
with a regression test; what remains here is the P2 set and the debt the phase deliberately took on.

- TD-37 Events are a dual write with no outbox: `QuestPublished`, `QuestUnpublished`,
  `QuestSafetyAssessed` and the participation events are published after the transaction commits
  against the in-process bus, so a crash between commit and publish loses them permanently. Harmless
  today (no cross-process consumer) and already the pending decision recorded in
  `ARCHITECTURE_DECISIONS.md`; mandatory before the first one (P02-P2).
- TD-38 `IN_REVIEW` has no human approval path. A favourable re-assessment now releases a Quest, but
  until Phase 14 provides a moderation queue there is no way for a person to clear one, and a Quest
  the rule engine flags in error waits on a policy change. Owners can still revise and re-assess.
- TD-39 The safety lexicon is deliberately small and English-only. Normalisation now defeats
  zero-width and fullwidth evasion, but leetspeak, transliteration and every non-English language
  are unhandled; Phase 06's classifier behind the AI Gateway is the answer, and until then the
  engine's false-negative rate is a known limit, not a defect.
- TD-40 `ACCEPTED` attempts never expire: `expires_at` is set only at START, so an accepted-and-
  abandoned attempt holds its unique active slot until the participant cancels. The transition table
  already defines `ACCEPTED --EXPIRE--> EXPIRED`; give acceptance a deadline and widen the sweep.
- TD-41 Repeat-completion farming: `COMPLETION_REQUESTED` is not an active state, so one account can
  loop accept → start → request-completion on the same Quest without limit. Harmless in Phase 02
  (nothing is awarded); Phase 05 must bound it before evidence carries value.
- TD-42 No idempotency keys on the new mutating routes. `POST /v1/quests` retried on a flaky network
  creates a duplicate draft; accept is protected by the partial unique index and publish/archive are
  naturally idempotent through 409. `API_CONVENTIONS.md` promises the header; no server code reads it.
- TD-43 Displayed terms can differ from enforced terms after a non-safety-relevant edit: widening the
  completion window changes the card immediately, while a participant who accepted earlier is frozen
  at the version they accepted. Correct, but the card should say which version it is describing.
- TD-44 `quest_discovery_idx` is partial, so a generic plan (a future `.prepare()`, or a pooler that
  promotes named statements) falls back to a sequential scan with no error. Re-check the plan when
  the first pooler is introduced.
- TD-45 A safety restriction demanding an age above 18 is refused at publication rather than
  enforced, because the three-band model cannot express it. Either widen the model or narrow
  `safetyRestrictionsSchema.minimumAge` to what the platform can enforce.
- TD-46 Mobile has no Quest edit screen: `PUT /v1/quests/:questId` exists and is exercised by the
  API tests, but the composer only creates. Owners cannot revise from the phone.
- TD-47 `quest_audit_ledger` retention is now documented in `docs/data/QUEST_DATA_MODEL.md`, but the
  append-only property is a code convention with no trigger or `REVOKE` behind it — the same gap as
  TD-34 for the consent ledger, and worth solving once for both.

### Phase 02 gate-audit follow-ups (2026-09-08, `docs/governance/PHASE_GATE_AUDIT_PHASE_02_2026-09-08.md`)

Residual items from the gate audit. Its 2 P0 and 5 P1 findings were repaired on the branch with
regression tests proven to fail before each repair; these are the P2/P3 remainder plus the one P1
deliberately deferred.

- TD-48 **P02-41 (P1) — RESOLVED 2026-09-11** (`audit(P02-41)`, gate condition A2 discharged).
  Suspending or deactivating an account left every Quest it had already published fully live:
  account state was checked when publishing but by no read path. Resolved by **ADR-014**, which
  chose the synchronous Identity query port over the event consumer (unreliable without a
  transactional outbox), the denormalised column (write amplification whose partially-applied state
  is a partially-applied sanction) and the hybrid (correct shape, not buildable yet). Identity now
  exports `OWNER_ELIGIBILITY` with a batch method; Quest Core conceals ineligible owners' Quests
  from detail, discovery and acceptance as a 404, refuses `start` and `completion-request` with the
  same 409 an unpublished Quest gives, and leaves `cancel` open. Reactivation restores visibility
  only where the Quest's own ADR-013 proof is still valid. Eleven regression tests (8 integration,
  3 unit), each proven to fail before the repair by reverting the three enforcement points
  individually. The list-by-owner staff endpoint that finding also mentioned is **not** part of this
  repair and is no longer needed for the sanction to work — it is now only a staff convenience, and
  is carried forward as TD-59.
- TD-49 **P02-43 (gate condition A5).** `effectiveCountryRules` fails _open_ on disjoint
  allow-lists: declared `['FR']` ∩ assessment `['DE']` = `[]`, and an empty allow-list means "no
  restriction", so the Quest becomes acceptable worldwide. Latent only because the Phase 02 engine
  always emits empty country arrays; must be closed before any HUMAN or AI decider can set country
  restrictions, i.e. before Phase 06.
- TD-50 **P02-44.** A newer, still-publishable decision that _tightens_ a live Quest (e.g.
  `RESTRICTED` with `minimumAge: 18`) is recorded but never applied — `assess()` handles the
  not-publishable and publishable-in-review cases and lets publishable-and-PUBLISHED fall through,
  leaving `published_minimum_age_band` stale while the safety badge shows the new decision.
- TD-51 **P02-42.** `accept()` evaluates block, country, age band and availability against an
  unlocked read; the locked re-read checks only state and version. A client omitting the optional
  `expectedPublishedVersion` while racing a republish is bound to a version its eligibility was
  never evaluated against.
- TD-52 **P02-45.** The auth guard returns on `@Public` _before_ the account-state check, so a
  deactivated or deletion-requested staff principal keeps `canViewSupport` on `GET /v1/quests/:id`.
  The lifecycle comment claiming "everything else is blocked by the lifecycle guard" is false for
  every `@Public` route — a Phase 01 seam surfaced by Phase 02.
- TD-53 **P02-46, P02-51.** Two erasure statements remain unbounded (`deleteForAccount`,
  `clearSanctionsBy`) beside the batching that exists precisely to avoid that; and an account large
  enough to exhaust `ERASURE_MAX_BATCHES` now fails loudly but still cannot be deleted without
  operator intervention. Both want the same fix: drain them in batches too, across cascade runs.
- TD-54 **P02-47.** The export omits the account's own safety assessments, version snapshots and
  ledger entries, and several columns of its own Quest rows; `truncated` also false-positives at
  exactly 1000 rows because the bound is tested with `===` rather than a `limit + 1` probe.
- TD-55 **P02-48.** Idempotency keys are allowed through CORS and sent by the client but read by no
  server code, while SKILL.md lists idempotency as Required. A retried `POST /v1/quests` duplicates
  the draft. (Supersedes the narrower TD-42.)
- TD-56 **P02-49, P02-52, P02-53.** `supportView` does not exclude `ERASED`, so a tombstoned Quest's
  owner id and assessment history stay staff-readable after deletion; `contentOf()` drops
  `location.label` when `countryCode` is absent, so a version snapshot omits a field its own hash
  covers; and a safety-driven withdrawal emits `QuestUnpublished{reason:'REVISED'}`, leaving
  consumers unable to tell a T&S takedown from an owner edit.
- TD-57 **P02-54, P02-55.** Test-quality debt: `lifecycle.test.ts` passes against an empty
  transition table, `quest.test.ts`'s exhaustiveness claim varies only one axis, a `content.test.ts`
  assertion is unfalsifiable by construction, and two integration assertions run against 404 bodies.
  The mobile copy tables miss three codes the server emits (`SAFETY_AGE_RESTRICTION_UNSUPPORTED`,
  `QUEST_NOT_OPEN`, `COUNTRY_UNKNOWN`) and the test iterates a hardcoded list rather than the
  server's vocabulary, so it cannot detect the gap.
- TD-58 **P02-50, P02-56, P02-57.** "Optional location constraints" (SKILL.md scope) is half
  implemented — the Quest's location is stored, hashed and assessed but constrains nothing, since
  acceptance is gated on the viewer's country against the owner's lists. Discovery pagination can
  still end early after `MAX_DISCOVERY_PASSES`. And the Phase 02 execution report's test and
  operation counts (275, 67) do not match the reproducible figures (283, 68). The
  `MAX_DISCOVERY_PASSES` half of this is now under slightly more pressure: the TD-48 repair filters
  ineligible owners in the same refill loop, so a page can be shortened by two independent causes
  instead of one. Correctness is unaffected (the cursor still advances over every row considered);
  what can happen is an early `hasMore: false` for a viewer whose visible catalogue is unusually
  sparse. The fix is the same one this item already wants — filter in SQL rather than after it.

- TD-59 **Staff list-by-owner endpoint (from P02-41, split out 2026-09-11).** With TD-48 resolved,
  a suspended owner's Quests are concealed automatically, so staff no longer _need_ to find and
  suspend each one by id for the sanction to take effect. What is still missing is the ability to
  enumerate one account's Quests for a moderation case — reviewing what an author published, or
  taking a permanent per-Quest action that should survive their reinstatement. Wants the existing
  `VIEW_QUEST_SUPPORT` permission and the audit ledger entry every support read should leave.

### Should fix

- TD-60 **`multer` high advisories — RESOLVED 2026-09-11** (`fix(deps)`). Observed the same day:
  `pnpm audit --audit-level=high` began failing on four advisories against `multer@2.2.0` —
  GHSA-wc9g-mqfw-jrwm (DoS via crafted multipart field names), GHSA-qfvm-cv95-jqjf (DoS via file
  descriptor leak on aborted uploads) and GHSA-535w-7cp7-47q4 (DoS via oversized array index),
  all high, plus GHSA-qvfw-j98x-7q72 (low, file-size-limit bypass via an async `fileFilter` race).
  One dependency path only: `apps/api → @nestjs/platform-express@12.0.1 → multer@2.2.0`. The
  lockfile was untouched by the TD-48 work, so this was a newly published advisory set against an
  unchanged dependency tree, not a regression.

  **Not reachable in QUEST**: there is no `FileInterceptor`, `FilesInterceptor`, `MulterModule`,
  multipart parser or upload route anywhere in the workspace, and `apps/api` imports only the
  `NestExpressApplication` _type_ from the package. Importing `@nestjs/platform-express` does pull
  multer's modules into the require graph, but the vulnerable code is in the multipart parser,
  which runs only when a multer middleware is mounted on a route — and none is. Phase 05 media
  goes direct to object storage (ADR-005), so nothing planned mounts one either.

  **Repaired rather than risk-accepted.** `@nestjs/platform-express@12.0.1` is the latest release
  and pins multer to exactly `2.2.0`; no published version depends on the fixed `2.3.0`, so an
  upgrade of the parent was not available and a pnpm override was the only route to the patch.
  `2.2.0 → 2.3.0` is a semver-minor bump inside the same major, and since QUEST invokes none of
  multer's API the compatibility surface is empty. `pnpm-workspace.yaml` now carries
  `overrides: { multer: '2.3.0' }`; the lockfile diff is ten lines and touches nothing else.
  `pnpm audit --audit-level=high` exits 0 again, with the two remaining highs being the
  pre-existing documented image-size acceptances (TD-17).

  Guarded by `apps/api/test/dependency-pins.test.ts`, which fails in the ordinary unit run if the
  override is ever lost — proven by removing it and re-installing. An audit gate catches this only
  after the regression is in the lockfile and only while the advisory database still lists it;
  the test catches it immediately and says why. **Remove the override** — and that test — once
  `@nestjs/platform-express` ships a release depending on `>=2.3.0` itself.

- TD-61 **The postgres image build is unverified (2026-09-12).** `fix(ci)` moved
  `infrastructure/docker/postgres` off the unbuildable `postgis/postgis:16-3.4` onto
  `postgres:16-bookworm` plus PGDG extension packages, but **the image was never built or run**: the
  cloud sandbox has a Docker daemon and no reachable container registry (`registry-1.docker.io`
  answers 403 through the egress proxy, so even `docker build --check` cannot resolve base metadata),
  and the desktop Linux VM has no Docker at all. Everything database-shaped was verified against
  natively installed PostgreSQL 16.13 + PostGIS 3.4.2 + pgvector 0.6.0, which exercises the same
  package names and the same migration path but is **not** the image. Before this is called proven,
  on a machine with Docker: `docker compose down -v`, `docker compose build --no-cache postgres`,
  `docker compose up -d --wait postgres redis`, then `SELECT version();` and the
  `pg_available_extensions` query, then the clean migration cycle and the integration suite. Note
  that PGDG bookworm will supply newer PostGIS and pgvector than the native packages above (PostGIS
  3.5.x, pgvector 0.8.x), which is expected and is what `default_version` should show.

- TD-62 **`pnpm format:check` is outside the turbo pipeline, so `turbo run lint typecheck test build`
  is not sufficient verification.** The P02-41 commit left two source files unformatted and passed
  every check that was actually run, while failing the mandatory CI `format:check` job; it was fixed
  twice independently (`580a954` on the device, an identical commit in the cloud clone), which is the
  clearest possible evidence that the gap is easy to fall into. `pnpm verify` does include it. Either
  make `format` a turbo task so `--filter`/`--force` runs cover it, or make the standing instruction
  "run `pnpm verify`, not a hand-picked subset". Until then, treat `format:check` as a separate
  mandatory step in every change.

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
