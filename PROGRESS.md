# QUEST Progress

## Current Phase

Phase 02 — Quest Core (branch `phase-02-quest-core`, 2026-09-08 — **gate audit run by the
implementing session: PASS WITH CONDITIONS, 79/100**,
`docs/governance/PHASE_GATE_AUDIT_PHASE_02_2026-09-08.md`; its last open P1, P02-41 / TD-48, was
remediated 2026-09-11 under ADR-014 and recorded in §7 of that report — **open P0: 0, open P1: 0**).
Not merged into `main`. Phase 03 is **not** authorized: condition A1 requires an independent
re-audit by a session with no implementation history, because neither the audit that produced that
verdict nor the remediation that closed its last finding was independent. The prompt is
`docs/governance/PHASE_02_GATE_AUDIT_PROMPT.md`.

## Status

**Phase 02 — implemented (2026-09-07), gate audit pending.** Entry conditions were confirmed from
repository evidence before any change: branch `phase-02-quest-core`, clean tree, Phase 01 baseline
`main` (`e0f1d4d`) an ancestor of HEAD, Phase 01 merged into `main` through PR #1, and no open
Phase 00/01 P0 or P1.

The phase implements the authoritative Quest lifecycle — draft, safety assessment, publication,
archive, staff sanction, unranked discovery, and participation through to proof-required completion.
Its defining decision is ADR-013: an approval belongs to content, not to a Quest id. Publication is
refused unless three independent layers agree — the shared Trust & Safety rule
(`canPublishWithAssessment`), the domain gate (`evaluatePublish`, which returns machine-readable
blockers), and the database CHECK `quest_published_requires_assessment`, which no code path,
migration or manual `UPDATE` can circumvent. A safety-relevant edit rehashes the content, which
makes the previous approval stale by definition, takes the Quest out of visibility and cancels the
attempts accepted under it.

Phase 01 boundaries are enforced mechanically: a dependency-cruiser rule forbids the Quest context
from reading identity or profile tables, owner facts arrive through the Identity-owned
`ACCOUNT_FACTS` port, no date of birth enters the context, and anything a caller may not know about
answers 404 rather than 403. Account-lifecycle obligations are wired rather than promised: a new
account-erasure registry runs every context's erasure inside the Identity deletion transaction and
refuses to run at all if a required contributor has not registered.

**Four independent adversarial reviews found 4 P0 and 20 P1 defects.** All 24 were repaired on the
branch with regression tests (the `fix(quests)` commit), together with the P2 items whose fix was small and
whose risk was real. The P0s were: a PRIVATE Quest acceptable by anyone who knew its id; safety
country restrictions recorded and never enforced; owner cards leaking non-PUBLIC profiles — including
13-15s, who can never be PUBLIC — to anonymous callers; and owner free text surviving erasure inside
a JSONB blob. Details and the full table are in
`docs/governance/PHASE_02_EXECUTION_REPORT_2026-09-07.md`. Residual P2 items are TD-37…TD-47.

Deliberately not built, and forbidden by a dependency rule so it stays that way: XP, badges,
leaderboards, followers or any social graph, crews, World Quest, the creator platform, brand
monetization, AI Quest generation, recommendation or ranking, and evidence verification.
Participation ends at `COMPLETION_REQUESTED`.

### Validations executed (Phase 02, 2026-09-07, after the review repairs)

| Check                                                                | Result                                                        |
| -------------------------------------------------------------------- | ------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`                                     | PASS                                                          |
| `pnpm verify`                                                        | PASS — 17/17 tasks; **275** unit tests across 12 workspaces   |
| `pnpm deps:check` (incl. two new Quest boundary rules)               | PASS — 0 violations, 246 modules, 588 dependencies            |
| Integration + E2E on real PostgreSQL 16 + PostGIS + pgvector + Redis | PASS — **71** tests (35 Quest integration, 2 SDK journeys)    |
| Clean-database migration → status → apply → status → apply again     | PASS — 3 applied, 0 pending, idempotent                       |
| Drizzle mirror vs migrated database                                  | PASS — every index and CHECK present in both                  |
| OpenAPI regenerate + `git diff`                                      | PASS — no drift; 67 operations                                |
| Builds (packages, api, web, admin)                                   | PASS                                                          |
| `pnpm audit --audit-level=high` / secret scan                        | PASS — same posture as Phase 01 (TD-17 exception); no secrets |
| Expo export, CI across the six mandatory jobs                        | **Not yet run** — required before the gate closes             |

### Gate audit 2026-09-08 (implementer-conducted — see condition A1)

Found **2 P0 and 5 P1** still live after the implementation review claimed all P0/P1 were repaired.
Three of them (P02-35, P02-36, P02-39) were introduced or left half-finished _by_ that round of
repairs — the signature of a review that verified its fixes existed rather than that they were
complete.

- **P02-34 (P0)** — erasure silently stopped after 5,000 Quests and reported success; reproduced
  with 240 Quests surviving a "completed" deletion. Now fails loudly and rolls back.
- **P02-35 (P0)** — owner and staff free text survived erasure in `quest_audit_ledger.metadata`,
  introduced by the P02-23 repair. Now redacted in both directions.
- **P02-36 (P1)** — a sanction against the erased owner's own Quest was never cleared.
- **P02-37 (P1)** — an owner could bury a staff sanction by re-assessing a suspended Quest,
  defeating the P02-10 repair.
- **P02-38 (P1)** — `evidence.notes` and `location.label` were hashed and shown to participants but
  never assessed.
- **P02-39 (P1)** — Quest owner cards leaked non-PUBLIC profiles, including 13-15s, to any
  signed-in caller; introduced by the P02-03 repair.
- **P02-40 (P1)** — the schema-parity test matched the constraint name inside the file's own header
  comment, so it passed with the publication gate's CHECK deleted from the mirror.

All repaired with regression tests, each proven to fail before its repair. **P02-41** (a suspended
owner's published Quests stay live) was accepted and deliberately not repaired at the time: it
needed a cross-context ADR. Residual P2/P3 are P02-42…P02-57.

### Gate remediation — P02-41 / TD-48 (2026-09-11, commit `audit(P02-41)`)

**Condition A2 is discharged.** The defect was reproduced first: eight integration tests written
against the unmodified branch, six failing on a real database — a suspended, deactivated or
deletion-requested owner's published Quests were readable, listed in discovery, and could be started
and submitted for completion.

**ADR-014** evaluates an event consumer, a denormalised flag, a synchronous port and a hybrid, and
chooses the **synchronous Identity query port**: without a transactional outbox an event consumer
fails open on a dropped message, which is the wrong direction for a safety sanction, and a
denormalised flag turns suspending a prolific author into a write amplification whose
partially-applied state is a partially-applied sanction. Identity now exports `OWNER_ELIGIBILITY`
with a batch method; Quest Core asks and never interprets an account state, so it contains no
lifecycle vocabulary at all and `deps:check` is unchanged at 0 violations.

Behaviour: an ineligible owner's Quest is a **404** everywhere (never a 403, and carrying no account
state, owner metadata or reason), absent from discovery via one batched lookup per refill pass (no
N+1, page size and cursor unaffected), and cannot be accepted. `start` and `completion-request`
return 409 with the same message an unpublished Quest gives, word for word; **`cancel` stays open**,
so nobody is trapped in an attempt by someone else's suspension. A failed lookup is ineligible and
increments `quest.core.owner_eligibility_unavailable`. Reactivation restores visibility only where
the Quest's own ADR-013 proof is still valid. Eleven regression tests (8 integration, 3 unit), each
proven to fail by reverting the three enforcement points individually against the full suite.

### Remaining P0 / P1 blockers

None on the branch: **open P0 = 0, open P1 = 0**, and no mandatory gate command failing. Open
conditions: **A1 independent re-audit**
(binding, blocks Phase 03 — unaffected by the remediation, which this same session wrote), A3 CI
green, A4 developer-machine reproduction, A5 country allow-list before Phase 06, A6 Phase 01's
carried conditions. A2 is discharged.

### TD-60 — `multer` advisories, raised and closed the same day (2026-09-11, commit `fix(deps)`)

`pnpm audit --audit-level=high` began failing on four advisories against `multer@2.2.0` (three high
— GHSA-wc9g-mqfw-jrwm, GHSA-qfvm-cv95-jqjf, GHSA-535w-7cp7-47q4 — and one low,
GHSA-qvfw-j98x-7q72), on the single path `apps/api → @nestjs/platform-express@12.0.1 → multer`. The
lockfile was untouched by the TD-48 work, so this was a newly published advisory set against an
unchanged tree.

Not reachable: no `FileInterceptor`, `MulterModule`, multipart parser or upload route exists
anywhere, and `apps/api` imports only the `NestExpressApplication` type. The code loads but the
parser never runs, because no multer middleware is mounted.

**Repaired rather than risk-accepted.** `12.0.1` is the latest `@nestjs/platform-express` and pins
multer to exactly `2.2.0`, so a parent upgrade was unavailable and an override was the only route
to the patch. `2.2.0 → 2.3.0` is semver-minor and QUEST calls none of multer's API, so the
compatibility surface is empty. `pnpm-workspace.yaml` carries the override with its reasoning
inline; the lockfile diff is ten lines. `pnpm audit --audit-level=high` exits 0 again, and
`apps/api/test/dependency-pins.test.ts` fails in the ordinary unit run if the override is ever
lost — proven by removing it. §8 of the gate-audit report has the detail.

**No mandatory gate command is now failing.**

## Completed (Phase 02 — Quest Core, branch `phase-02-quest-core`)

- **Contracts** — `packages/types/src/quest/`: the Quest and participation state-transition tables,
  the category taxonomy, difficulty, visibility and evidence vocabulary, the three-concept duration
  model, eligibility and the age-band helpers, `canonicalQuestContent` and the content-hash version,
  and the request/response schemas for every route.
- **Events** — `packages/events/src/catalog/quest.ts`: twelve events across the `quest` and
  `quest_participation` aggregates, carrying ids, hashes, states and enum categories only.
- **Persistence** — `apps/api/drizzle/0002_quest_core.sql`: six tables, thirteen CHECK constraints,
  twelve indexes, the seeded category catalogue, and `quest_published_requires_assessment`. The
  Drizzle mirror is complete and an integration test compares it against the migrated database.
- **Trust & Safety** — `RuleBasedSafetyDecision` replaces the Phase 00 placeholder: a deterministic
  four-tier lexicon, fail-closed on error, on malformed input and on unassessable text, with
  NFKC-folded normalisation that strips zero-width and bidi formatting characters.
- **API** — sixteen routes: authoring, assessment, publication, archive, discovery, detail, the
  category catalogue, participation, and the staff support surface. Refusals are 409s listing
  machine-readable blockers.
- **Account lifecycle** — a cross-context account-erasure registry running inside the Identity
  deletion transaction, plus the Quest export and erasure contributors.
- **Clients** — `@quest/api-client` quest endpoints; four mobile screens; the admin Quest support
  page behind `VIEW_QUEST_SUPPORT` / `SANCTION_QUEST`.
- **Operations** — `pnpm --filter @quest/api quests:process-expiries` (idempotent; a scheduled
  worker replaces it with the first deployment, TD-21).
- **Owner lifecycle** (gate remediation, 2026-09-11) — Identity's `OWNER_ELIGIBILITY` port with
  batch lookup, and its enforcement in Quest read, discovery and participation (ADR-014).
- **Documentation** — ADR-013, ADR-014, `docs/data/QUEST_DATA_MODEL.md`, `docs/api/QUEST_API.md`,
  `docs/security/QUEST_THREAT_MODEL.md`, `docs/product/PHASE_02_QUEST_ACCEPTANCE.md`,
  `docs/ux/PHASE_02_MOBILE_QUESTS.md`; `docs/data/IDENTITY_DATA_MODEL.md` corrected where Phase 02
  replaced the event-subscription erasure design with the in-transaction registry.

## Phase 01

**Phase 01 — independent phase-gate audit 2026-09-06: PASS WITH CONDITIONS (86/100).** The audit
reproduced every validation (cache-cleared `pnpm verify`, integration + E2E on real
PostgreSQL/Redis, clean-database migrations, OpenAPI drift, builds, mobile export, `deps:check`,
secret scan) and found 1 P0 and 8 P1 defects — deletion cancel/execute race, orphaned or
prematurely deleted storage objects, silent erasure failures, advisory lifecycle transitions,
paused erasures starving the job window, staff-on-staff sanctions, `trust proxy` hop count,
authentication timing/code-order issues, admin CSRF and the persistence-boundary rule. All were
repaired on the branch (`audit(P01-*)` commits) with regression tests and the full validation set
re-run green. Outstanding conditions: **C1-P01 CI must run green for this branch** (the workflow
triggers only on `push: main` and `pull_request`, so no run exists yet — open a PR), C2-P01
developer-machine reproduction, C3-P01 mail transport before public sign-up, C4-P01 legal sign-off
on the minimum-age assumption. New debt: TD-29…TD-36.

**Phase 01 implemented.** Entry conditions were
confirmed from repository evidence: the Phase 00 audit recorded PASS WITH CONDITIONS (85/100),
`origin/main` = `f30f860` (C1 CI remediation pushed — the follow-up run's result is recorded below
as the operator reports it), and `pnpm verify` was green on the baseline before any change.
Deliverables, validations, review findings and debt are in the sections "Phase 01" below.

**Phase 00 — independent phase-gate audit 2026-09-05: PASS WITH CONDITIONS** (see
`docs/governance/PHASE_GATE_AUDIT_2026-09-05.md`). Audit-time repairs: CI security gate risk
acceptance (TD-17), request-context middleware now precedes body parsing/logging (413/400 envelopes
and log lines carry ids), malformed-JSON contract message, build-script allow-list, stray report
moved to `docs/governance/`. Conditions C1–C3 in the audit must be satisfied at the start of Phase 01.

**Implemented — Phase 00 complete.** Phase 00 was executed on 2026-09-04
following the audit in `docs/governance/PHASE_GATE_AUDIT_2026-09-04.md` (which recorded FAIL /
14/100 because the phase had never been run). Phase 01 is **not** authorized by this file; only a
new independent audit can authorize it.

## Completed (Phase 00)

- Monorepo: pnpm 10 workspaces + Turborepo; TypeScript 5.9 strict base; ESLint 9 type-aware flat
  config; Prettier; Vitest; dependency-cruiser boundary rules (`pnpm deps:check`); `pnpm verify`.
- `apps/api` (NestJS 12): validated zod config (fail-fast, production hardening), pino structured
  logging with redaction, request/correlation-id middleware (AsyncLocalStorage), helmet, CORS
  allow-list, URI versioning (`/v1`), global throttler, standard error envelope filter, zod
  validation pipe, `/health`, `/ready` (Postgres+Redis critical, storage degraded),
  `/v1/system/info`; infrastructure ports for PostgreSQL (Drizzle/pg), Redis (ioredis), object
  storage (S3/MinIO adapter behind `ObjectStoragePort`), events (`InMemoryEventBus`), AI
  (`NotConfiguredAiGateway`); `trust-safety` module with fail-closed `SafetyDecisionPort`;
  `system` module; multi-stage Dockerfile.
- Database: migration runner (`db:migrate`, `db:migrate:status`, guarded `db:reset:dev`), initial
  migration enabling PostGIS + pgvector + `updated_at` trigger function; custom PostGIS+pgvector
  Docker image; integration test suite against a real database.
- `apps/web`, `apps/admin` (Next.js 16): shells, validated public env, shared API client, error /
  not-found / loading boundaries, responsive token-based layout, security headers; admin role /
  permission model with `RoleGate` (presentation gate, API remains authority).
- `apps/mobile` (Expo SDK 57, expo-router): shell, navigation, env, API client with secure-storage
  token provider, error boundary, loading state, theme from `@quest/ui` tokens,
  `SecureStoragePort` (expo-secure-store adapter), permissions architecture with purpose strings;
  dependency versions aligned to Expo's bundled set; Metro export verified.
- Packages: `@quest/types` (error envelope, pagination, common primitives, health, **safety
  contract** with deterministic publish rule), `@quest/config`, `@quest/events` (envelope, ports,
  bus), `@quest/ai` (task definitions, gateway port, prompt registry, model router, audit record,
  capability contracts), `@quest/ui` (tokens, WCAG-tested), `@quest/analytics`, `@quest/api-client`.
- Local infrastructure: `docker-compose.yml` (PostgreSQL 16 + PostGIS + pgvector, Redis 7, MinIO +
  bucket init, health checks, volumes).
- Terraform baseline: modules `networking`, `ecs-service`, `rds-postgres`, `elasticache-redis`,
  `s3-media`, `cdn-waf`, `messaging`, `secrets`, `observability`; `environments/dev` with
  environment-aware variables; no secrets in code.
- CI (`.github/workflows/ci.yml`): quality (format/lint/typecheck/deps), test+build (+ Metro
  export), migrations + integration tests on real PostGIS/pgvector, infrastructure (compose config,
  terraform fmt/validate), security (TruffleHog verified secrets, `pnpm audit` high+).
- Documentation: ADR-001…010; architecture docs 01–13 + dependency rules; API conventions;
  Trust & Safety baseline (D-10); security architecture; privacy principles; developer setup; AI and
  data guides; module layout README.
- Claude pack hardening: all 13 agents carry Role/Scope/Responsibilities/Inputs/Outputs/
  Constraints/Quality Gates/Escalation; reusable skills carry Use when/Inputs/Workflow/
  Constraints/Done when; every phase skill has explicit Entry/Exit conditions; `CLAUDE.md` matches
  the tree and references the canonical quality gates; Windows-only bootstrap script removed.

## Validations executed (cloud workspace, 2026-09-04)

| Check                                                                                                                       | Result                                                                                                                                                                  |
| --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`                                                                                            | PASS                                                                                                                                                                    |
| `pnpm format:check`                                                                                                         | PASS                                                                                                                                                                    |
| `pnpm lint` (all workspaces, type-aware)                                                                                    | PASS                                                                                                                                                                    |
| `pnpm typecheck` (all workspaces)                                                                                           | PASS                                                                                                                                                                    |
| `pnpm deps:check` (dependency-cruiser)                                                                                      | PASS — 0 violations                                                                                                                                                     |
| `pnpm test` (unit)                                                                                                          | PASS — 90 unit tests across 11 workspaces (api 31, types 17, ai 9, events 7, config 5, api-client 5, ui 4, admin 4, mobile 4, analytics 3, web 1) + 4 integration tests |
| `pnpm build` (packages, api, web, admin)                                                                                    | PASS                                                                                                                                                                    |
| Mobile Metro bundle (`expo export --platform android`)                                                                      | PASS — Hermes bundle produced                                                                                                                                           |
| API boots (`node dist/main.js`) and serves `/health`, `/ready`, `/v1/system/info`, 404 envelope                             | PASS; fail-fast on invalid env verified                                                                                                                                 |
| Migrations on real PostgreSQL 16 + PostGIS 3.4.2 + pgvector 0.6.0: status (pending) → up → status (clean) → up (idempotent) | PASS                                                                                                                                                                    |
| `pnpm --filter @quest/api test:integration` (RUN_INTEGRATION=true)                                                          | PASS — 4 tests                                                                                                                                                          |
| `db:reset:dev` guards (production / non-local host refused; local reset works)                                              | PASS                                                                                                                                                                    |
| `docker compose config --quiet`                                                                                             | PASS                                                                                                                                                                    |
| `terraform fmt -recursive -check` (via OpenTofu 1.9.1)                                                                      | PASS                                                                                                                                                                    |
| HCL parse of all 31 `.tf` files (python-hcl2) + module wiring init                                                          | PASS                                                                                                                                                                    |
| CI workflow YAML parse                                                                                                      | PASS                                                                                                                                                                    |

## Validations blocked (honest status)

| Check                                                   | Status                                              | Reason / unblock                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docker compose up --wait` runtime                      | **LOCAL RUNTIME VALIDATION BLOCKED**                | No Docker daemon in the build sandbox; **BLOCKED_BY_LOCAL_PREREQUISITE: Docker Desktop** on the developer machine. Compose config validated; the same services were exercised via a native PostgreSQL 16 install for migration validation. CI job `migrations` runs the real compose stack.                                           |
| `terraform validate` / `init`                           | **BLOCKED (network policy)**                        | Provider registries (registry.terraform.io / registry.opentofu.org / releases.hashicorp.com) are unreachable from the sandbox. `fmt` and full HCL parsing passed; CI job `infrastructure` runs `terraform validate` for every module and the dev environment.                                                                         |
| `pnpm install` + `pnpm verify` on the developer machine | **LOCAL RUNTIME VALIDATION BLOCKED (this session)** | The Claude desktop VM linked to `C:\Quest` has no network egress for npm, so dependencies could not be installed there; every check above was executed on the identical tree in the cloud workspace. Run `corepack enable && pnpm install --frozen-lockfile && pnpm verify` in a Windows terminal in `C:\Quest` to reproduce locally. |
| `expo install --check` (online)                         | BLOCKED (network policy)                            | Replaced by an offline comparison against `expo/bundledNativeModules.json` — all managed deps aligned.                                                                                                                                                                                                                                |

## CI remediation log (condition C1)

| Run                                                                                                   | Result                                                                                                                                                                                                 | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Repair                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GitHub Actions run 33961497878 (`568562b`, first ever run)                                            | **FAIL** — 4 of 5 jobs green (quality, unit tests + builds, migrations + integration tests, secret scan + audit); job "Compose config · Terraform fmt/validate" failed at step "Validate every module" | `modules/cdn-waf` declares `configuration_aliases = [aws.us_east_1]` (CloudFront-scoped WAF must live in us-east-1) and cannot be validated as a root module: `Error: Provider configuration not present … provider["registry.terraform.io/hashicorp/aws"].us_east_1`. Compose config and `terraform fmt` passed. Also: Node.js 20 deprecation warnings for `actions/checkout@v4`, `actions/setup-node@v4`, `pnpm/action-setup@v4`, `hashicorp/setup-terraform@v3`. Because `cdn-waf` sorts first, the remaining eight modules were never reached in run #1. | Added `modules/cdn-waf/examples/validate/` (a root that supplies both provider configurations, never applied) and a module README; CI now validates alias-dependent modules through their `examples/*` roots and fails if such a module has none; split the job into `compose` and `terraform` so failures are attributable; action runtimes moved to Node-24 generations (`checkout@v6`, `setup-node@v7`, `pnpm/action-setup@v6` resolving pnpm from `packageManager`, `setup-terraform@v4` still pinning Terraform 1.9.8); `trufflehog` pinned to `v3.97.4` instead of `@main`. Application runtime unchanged (Node 22, pnpm 10.28.0). |
| Run 34025672933 (`f30f860`, after `chore(ci): fix Phase 00 Terraform validation and action runtimes`) | **SUCCESS** — all six jobs green (quality, unit tests + build, migrations + integration, compose, terraform, security). **C1 satisfied** (observed 2026-09-06 in GitHub Actions).                      | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `phase-01-identity` branch                                                                            | **NO RUN** — the workflow triggers on `push: [main]` and `pull_request` only; the branch was pushed without a PR. Condition **C1-P01**: open a PR and confirm green before Phase 02.                   | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

## Completed (Phase 01 — Identity & Profiles, branch `phase-01-identity`)

Scope: `.claude/skills/quest-phase-01-identity/SKILL.md` plus the mandated capability list
(account, authentication, public profile, sessions, devices, roles/permissions, email
verification, lifecycle states, interests/onboarding, consent history, privacy settings, age/minor
policy foundation, blocking, deletion-request architecture, user-data export contract). Strict
AUTHENTICATION / ACCOUNT / PUBLIC PROFILE separation; immutable UUID v7 identity keys; no identity
microservice; nothing from Phase 02 (no quests, feed, followers, XP, crews, creators, brands, AI).

- Contracts (`@quest/types`): lifecycle state machine, age-band policy with per-band privacy
  limits, shared `Role`/`Permission` vocabulary, auth/account/profile schemas; identity event
  catalogue in `@quest/events` (`identity.account.*`, `profiles.profile.updated`).
- Database: migration `0001_identity_profiles` — 16 tables (ACCOUNT: account, account_role,
  consent_record, account_deletion_request, data_export_request; AUTHENTICATION:
  account_credential, account_identity, verification_code, auth_session, device,
  identity_audit_ledger; PROFILE: profile, interest, account_interest, privacy_settings,
  account_block), partial unique indexes for email/username, DB checks for the state machine
  (`account_email_lifecycle_check`, `account_active_verified_check`), interest catalogue seed.
- API (`modules/identity`, `modules/profiles`, 51 routes documented in `docs/api/openapi/v1.json`):
  registration (password + Apple/Google OIDC adapters + local FAKE adapter), Argon2id credentials
  with lockout and generic errors, HS256 access tokens + rotating refresh tokens with reuse
  detection, per-request session validation (immediate revocation), email verification and
  password reset codes, sessions/devices, consent ledger with reprompt detection, deactivate /
  suspend / reinstate, deletion request (30-day grace, re-auth, cancel restores the previous
  state, pauses under suspension) + `AccountDeletionJob` cascade, data export contract
  (`DataExportContributor` registry, JSON bundle, expiry sweep), staff RBAC endpoints, global
  default-deny `AuthGuard`, per-route rate limits, audit ledger, metrics; own/public profile with
  visibility + block precedence, username availability, pre-signed avatar uploads,
  interests/onboarding, age-band privacy policy, blocks; operator CLI (`identity:grant-role`,
  `identity:process-deletions`, `identity:process-exports`); OpenAPI generated from zod (ADR-012).
- Clients: `@quest/api-client` typed identity endpoints + `AuthSession` (single-flight refresh);
  mobile sign-up / sign-in / verify / profile / interests / home / privacy / account / deletion
  screens with secure token storage and server-derived routing; admin staff sign-in (httpOnly
  cookies) + account support lookup with suspend/reinstate, reusing the shared RBAC vocabulary.
- Governance: ADR-011 (identity provider strategy + token model), ADR-012 (OpenAPI from zod),
  `docs/product/PHASE_01_IDENTITY_ACCEPTANCE.md` (G0, 22 criteria → tests),
  `docs/security/IDENTITY_THREAT_MODEL.md` (23 threats → code + tests, residual risks),
  `docs/security/IDENTITY_PRIVACY_CLASSIFICATION.md`, `docs/data/IDENTITY_DATA_MODEL.md`
  (deletion cascade + export contract), `docs/api/IDENTITY_API.md`,
  `docs/ux/PHASE_01_MOBILE_ONBOARDING.md`; architecture docs 03/04/05/06/07/09 updated.

## Validations executed (Phase 01, cloud workspace, 2026-09-06)

| Check                                                                                                                                                                     | Result                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`                                                                                                                                          | PASS (lockfile additions only: `jose`, `@node-rs/argon2`, `server-only`, workspace links)                                                                        |
| `pnpm verify` (format, lint type-aware, typecheck, deps:check, unit tests, builds)                                                                                        | PASS — 17/17 tasks; unit tests 142 across 11 workspaces (api 54, types 34, events 11, api-client 9, ai 9, mobile 8, config 5, admin 4, ui 4, analytics 3, web 1) |
| `pnpm --filter @quest/api test:integration` on PostgreSQL 16 + PostGIS 3.4.2 + pgvector 0.6.0 + Redis 7                                                                   | PASS — 27 tests: 4 migration, 22 identity & profiles, 1 SDK-driven E2E onboarding journey                                                                        |
| Migrations from a clean database → status pending → up → status clean → up again (idempotent)                                                                             | PASS (integration harness drops/recreates `public` on every run)                                                                                                 |
| Builds: packages (tsc), api (tsc), web + admin (`next build`), mobile Metro export (`expo export --platform android`)                                                     | PASS                                                                                                                                                             |
| `pnpm deps:check` incl. new rule `profiles-must-not-import-identity`                                                                                                      | PASS — 0 violations                                                                                                                                              |
| Security & privacy tests (guard matrix, enumeration, lockout, reuse detection, DOB/push-token/hash leak checks, minor policy, block precedence, cascade, export contents) | PASS (unit + integration suites listed in the acceptance document)                                                                                               |
| Six-role review (CTO, Identity, Security, Privacy, Data, QA)                                                                                                              | 1 P0 + 6 P1 + 13 P2 found; all P0/P1 and 9 P2 repaired in `fix(identity)`; remaining P2 recorded as TD-21…TD-28                                                  |

## Validations blocked (Phase 01, honest status)

- Docker runtime and `terraform validate` remain sandbox-blocked as in Phase 00 (CI covers both).
- Mobile component rendering tests (RNTL/jest-expo) not set up — TD-06; logic is unit-tested and the bundle is verified through Metro.
- Admin console has no automated test (TD-24); staff endpoints are covered by the API integration suite.
- Real mail delivery, Apple/Google native sign-in UI, avatar upload UI: not exercised end-to-end (TD-21, TD-27).
- `pnpm install`/`pnpm verify` on the developer machine and the GitHub Actions run for this branch: to be executed by the operator; CI job `migrations` runs the new integration + E2E suites.

## Validations executed (Phase 01 gate audit, 2026-09-06, after the audit repairs)

| Check                                                                    | Result                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm verify` with the Turborepo cache deleted                           | PASS — 17/17 tasks; **145** unit tests across 12 workspaces                                                                                                                                                                                                                                                                                                                                          |
| Integration + E2E on PostgreSQL 16.13 + PostGIS 3.4.2 + pgvector + Redis | PASS — **32** tests (incl. 5 new audit regression tests)                                                                                                                                                                                                                                                                                                                                             |
| Clean-database migration → status → apply → status → apply again         | PASS — idempotent, 16 phase tables, catalogue seeded once                                                                                                                                                                                                                                                                                                                                            |
| OpenAPI regenerate + `git diff`                                          | PASS — no drift; 51 operations                                                                                                                                                                                                                                                                                                                                                                       |
| Builds (packages, api, web, admin) + `expo export --platform android`    | PASS                                                                                                                                                                                                                                                                                                                                                                                                 |
| `pnpm deps:check` (incl. the two new persistence-boundary rules)         | PASS — 0 violations, 205 modules                                                                                                                                                                                                                                                                                                                                                                     |
| Local developer-environment repairs (post-audit)                         | Root `.env` is loaded by every CLI through one dependency-free loader in the API CLI layer (`apps/api/src/cli/dev-env.ts`, called by `applyDevEnv()`); each integration suite owns a `quest_it_<file>` database so parallel test files no longer race over one schema; migration bootstrap from an empty database asserted; Vitest config warnings resolved (`vitest.config.mts`, single SWC plugin) |
| Secret scan / `pnpm audit --audit-level high`                            | PASS — no secrets; 2 high are the documented TD-17 exception                                                                                                                                                                                                                                                                                                                                         |

## Remaining P0 / P1 blockers

- None. The gate audit's P0 and P1 findings were repaired on the branch with regression tests; the
  residual P2/P3 items are TD-29…TD-36. Phase 01 is committed on `phase-01-identity` (9 phase
  commits + 3 `audit(P01-*)` commits + this documentation commit on top of `f30f860`); not merged.

## Next Actions

1. **C1-P02**: run the independent Phase 02 gate audit using
   `docs/governance/PHASE_02_GATE_AUDIT_PROMPT.md` in a fresh session. Do not skip it and do not
   answer its questions on the auditor's behalf. It must now also cover the TD-48 remediation
   (ADR-014 and §7 of the audit report), which was written by the same session that implemented the
   phase and is therefore no more self-certifiable than the phase was.
   1b. ~~**TD-60**: close the `multer` high advisories.~~ Done 2026-09-11 (`fix(deps)`); the audit gate
   is green. Remove the override and its guard test when `@nestjs/platform-express` ships a release
   depending on multer `>=2.3.0`.
2. **C2-P02**: `pnpm install --frozen-lockfile && pnpm verify` in `C:\Quest`, plus
   `pnpm --filter @quest/mobile exec expo export --platform android`; record the results here.
3. **C3-P02**: open a pull request for `phase-02-quest-core` so the CI workflow runs, and confirm
   all six mandatory jobs are green.
4. Carried from Phase 01: C1-P01 (CI green for `phase-01-identity`), C3-P01 (mail transport before
   public sign-up), C4-P01 (legal sign-off on the minimum-age assumption).
5. Only after the Phase 02 audit records PASS or PASS WITH CONDITIONS: merge to `main`, then invoke
   the Phase 03 command — never before.

## Last Decision Summary

Modular monolith (ADR-001) on PostgreSQL/PostGIS/pgvector (ADR-002, ADR-010) with EventBridge/SQS
messaging (ADR-003), provider-independent AI Gateway (ADR-004), direct-to-storage media (ADR-005),
Expo mobile (ADR-006), NestJS + zod (ADR-007), AWS me-central-1 (ADR-008), pnpm/Turborepo toolchain
(ADR-009), immutable-id identity with Argon2id + HS256/rotating-refresh tokens and OIDC adapters
(ADR-011), OpenAPI generated from zod contracts (ADR-012), and Quest publication gated by a content
hash and enforced in three layers — shared rule, domain gate, database CHECK (ADR-013), with owner
account lifecycle governing published content through a synchronous Identity query port (ADR-014).
