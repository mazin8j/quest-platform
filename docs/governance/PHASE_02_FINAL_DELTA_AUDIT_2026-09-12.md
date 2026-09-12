# QUEST — Phase 02 final delta audit (2026-09-12)

## 1. Auditor independence statement — READ THIS FIRST

**This document does not discharge condition A1, and A1 is recorded below as FAIL.**

The prompt that produced this report opens with four statements — that the auditor did not implement
Phase 02, the P02-41/TD-48 remediation, the TD-60 dependency remediation, or the PostgreSQL CI image
remediation. **All four are false of the session that wrote this document.** This session wrote
`0f2b051`, `5fd73cc`, `05d82c9`, `d19899a` and `3511c01`, and the Phase 02 implementation before them.
An audit of one's own work cannot satisfy a condition whose entire purpose is independence.

What makes this document worth having anyway is that **its verdict is adverse**. Three P1 defects are
recorded below, all in code this session wrote or left standing, and the gate therefore **FAILS on
substance regardless of who signs it**. Asserting a failure against one's own work is not
self-certification; the conflict of interest runs only one way, and this report does not travel in
that direction. Nothing here should be read as clearing Phase 02.

Independence was partially recovered by delegating the adversarial work to three subagents with no
implementation history and no access to this session's reasoning. Each was briefed only with the repo,
the claims to falsify, and an instruction to be adversarial. Their findings are attributed below. The
P1 in §18 was then reproduced a fourth time by the author of this document, directly, before being
recorded — a finding against one's own code deserves that much.

A genuinely independent session must still run the full audit. It should treat this document as a
**set of leads and a disclosure of known defects**, not as evidence.

## 2. Entry verification

| Condition                                                                                | Result                                                                  |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Branch is `phase-02-quest-core`                                                          | PASS                                                                    |
| Working tree clean                                                                       | PASS (verified before and after every probe)                            |
| `main` is the Phase 01 baseline                                                          | PASS — `e0f1d4d` "Merge pull request #1 from mazin8j/phase-01-identity" |
| `phase-01-approved` (`26182c3`) is an ancestor of HEAD                                   | PASS                                                                    |
| `git log main..phase-01-identity` empty                                                  | PASS — Phase 01 fully merged                                            |
| `0f2b051`, `5fd73cc`, `580a954`, `05d82c9`, `d19899a` in ancestry                        | PASS — all five                                                         |
| All commits since `main` are Phase 02 / audit / remediation / CI / security / governance | PASS — 14 commits, listed in §5                                         |
| Phase 00 / Phase 01 open P0 or P1                                                        | None recorded; not independently re-audited (out of scope)              |

One untracked item exists on the device working copy, `Claude outputs/` — a desktop-app artefact, not
repository content. The cloud checkout used for this audit is clean.

## 3. Audited HEAD and tree

|                                 |                                                |
| ------------------------------- | ---------------------------------------------- |
| HEAD (audit checkout)           | `3511c01248d0e686b12c4e294acd1c6c5a0528b9`     |
| HEAD (`C:\Quest`, same content) | `5a050052143faee0a331ae5426964ee27f551cc6`     |
| **Tree hash (both)**            | **`d1c0a498c4de09312b9d9d4c3959fdce00f5ed2f`** |

The two checkouts have identical content and divergent lineage: every commit was re-applied with
`git am`, so hashes differ while trees match. The tree hash is the reliable identifier.

## 4. GitHub CI

Verified against the public API (`api.github.com/repos/mazin8j/quest-platform`), no token required.

| Run    | SHA           | Result            |
| ------ | ------------- | ----------------- |
| **#8** | **`d19899a`** | **success — 6/6** |
| #7     | `1ae3567`     | failure           |
| #6     | `0f2b051`     | failure           |

Run #8, all six mandatory jobs `success`: Format · Lint · Typecheck · Dependency rules; Unit tests ·
Build; Migrations · Integration tests; Compose config; Terraform fmt · validate; Secret scan ·
Dependency audit. Every step of the Migrations job passed, beginning with `Start PostgreSQL (PostGIS +
pgvector) and Redis`.

**The CI SHA is not the audited HEAD.** CI tested `d19899a`; HEAD is one commit ahead (`3511c01` /
`5a05005`). The delta is documentation only — `BACKLOG.md`, `PROGRESS.md` and
`docs/governance/PHASE_02_FINAL_DELTA_AUDIT_PROMPT.md`, +79/−31 lines, no code, tests, migrations or
dependency files (`git diff --stat d19899a..HEAD`). The difference is therefore harmless for A3, and
**A3 is recorded as PASS for `d19899a`**. Note that `5a05005` is currently unpushed, so CI has not run
on the exact audited tree.

Runs #6 and #7 failing is itself evidence: both failed on `pnpm format:check`, confirming TD-62
empirically rather than by argument.

## 5. Commits since `main`

```
5a05005 docs(governance): record CI green on d19899a and close TD-61
d19899a docs(governance): record the image change and two verification gaps
05d82c9 fix(ci): refresh postgres image for integration tests
580a954 style(phase-02): normalize remediation formatting
1ae3567 docs(governance): prompt for the independent Phase 02 delta audit
5fd73cc fix(deps): take the patched multer through a pnpm override
0f2b051 audit(P02-41): enforce owner lifecycle on published quests
7c3b8c9 docs(backlog): record the Phase 02 gate-audit residual findings
ae863f5 audit(P02): gate audit findings — 2 P0 and 5 P1 repaired
c7515bd docs(quests): state the Phase 02 commit range without a fixed count
4803e7d docs(quests): name the Phase 02 baseline as it exists in C:\Quest
b253a16 docs(quests): Phase 02 documentation, ADR-013 and the gate-audit prompt
0e569de fix(quests): repair every P0 and P1 from the Phase 02 adversarial review
32e7ea2 feat(quests): Phase 02 Quest core with a fail-closed publication gate
```

All Phase 02 scope. No later-phase branch, no merge into `main`.

## 6. Commands executed

`.turbo` deleted, then: `pnpm install --frozen-lockfile`; `pnpm format:check`;
`pnpm turbo run lint typecheck test build --force`; `pnpm deps:check`; `pnpm db:migrate:status` /
`pnpm db:migrate` ×2 / `pnpm db:migrate:status` against a brand-new database;
`npx vitest run --project integration` (whole project); `pnpm --filter @quest/api openapi:generate`
then `git diff --exit-code -- docs/api/openapi`; `pnpm audit --audit-level=high`;
`npx expo export --platform android` (offline); `docker compose config --quiet`;
`docker build --no-cache` (**refused — see §12**); `docker build --check` (refused);
direct `psql` probes against the migrated schema; three subagent audits with their own scratch
integration specs; one direct reproduction spec written, run and deleted by the author.

The `-t` name filter was never used on the integration suite: it skips the per-file migration
bootstrap and produces false negatives (a trap recorded from an earlier audit).

## 7. Cold local validation

| Check                                              | Result                                                  |
| -------------------------------------------------- | ------------------------------------------------------- |
| `pnpm install --frozen-lockfile`                   | PASS                                                    |
| `pnpm format:check`                                | **PASS** — "All matched files use Prettier code style!" |
| `pnpm turbo run lint typecheck test build --force` | **PASS — 43/43 tasks**                                  |
| `pnpm deps:check`                                  | **PASS — 0 violations, 247 modules, 594 dependencies**  |

## 8. Test counts (measured, not quoted)

|                   |                                                                                                                                                  |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Unit tests        | **296** across 11 workspaces (`@quest/api` 166, types 63, mobile 18, events 11, api-client 9, ai 9, admin 7, config 5, ui 4, analytics 3, web 1) |
| Integration / E2E | **5 files, 84 tests, 84 passed, 0 skipped, 0 failed**                                                                                            |

No suite reported 0 tests.

## 9–11. PostgreSQL, PostGIS, pgvector versions

|            | Observed                                                                              | Source                                       |
| ---------- | ------------------------------------------------------------------------------------- | -------------------------------------------- |
| PostgreSQL | **16.13** (`PostgreSQL 16.13 (Ubuntu 16.13-0ubuntu0.24.04.1) on x86_64-pc-linux-gnu`) | natively installed, **not the Docker image** |
| PostGIS    | **3.4.2**                                                                             | natively installed                           |
| pgvector   | **0.6.0**                                                                             | natively installed                           |

These are Ubuntu 24.04 archive packages, not the PGDG Bookworm packages the image installs. The
image's versions are **unobserved**; PGDG bookworm is expected to supply PostGIS 3.5.x and pgvector
0.8.x. Treating these figures as the image's versions would be wrong.

## 12. Clean Docker image build — **UNABLE TO VERIFY**

`docker compose build --no-cache postgres` could not be executed. A Docker daemon was started
successfully in the audit environment, but **no container registry is reachable**:
`registry-1.docker.io` answers `403 Forbidden` through the egress proxy, so base-image metadata cannot
be resolved — `docker build --check` fails at the same point. `ghcr.io`, `quay.io`, `public.ecr.aws`
and `mirror.gcr.io` are all refused. The linked desktop VM has no Docker binary.

Static verification of `infrastructure/docker/postgres/Dockerfile` **did** pass:

- base is `postgres:16-bookworm` (official, Debian 12) — not `postgis/postgis`
- installs `postgresql-16-postgis-3`, `postgresql-16-postgis-3-scripts`, `postgresql-16-pgvector`
- adds **no** repository: it reuses the base image's own `/etc/apt/sources.list.d/pgdg.list`, signed
  by `/usr/local/share/keyrings/postgres.gpg.asc` (PostgreSQL Debian Repository key
  `B97B0AFC AA1A47F0 44F244A0 7FCC7D46 ACCC4CF8`) — confirmed by reading the upstream
  `docker-library/postgres` 16/bookworm Dockerfile
- contains **none** of: `Acquire::Check-Valid-Until=false`, `--allow-unauthenticated`, `apt-key`,
  unsigned repositories, disabled signature verification — verified by grep over the file
- no `/docker-entrypoint-initdb.d` script, so Docker does **not** pre-create extensions; migration
  `0000_platform_extensions` is the sole owner (confirmed in §13–16, where the extensions appear in a
  fresh database only after `db:migrate`)
- ends with build-time assertions that `postgis.control` and `vector.control` exist under
  `pg_config --sharedir`

`docker compose config --quiet` passes and still resolves this Dockerfile for the `postgres` service.

**Secondary evidence only:** CI run #8's `Start PostgreSQL (PostGIS + pgvector) and Redis` step built
this image from a fresh checkout on a runner with registry access, and the whole Migrations job passed.
That is strong evidence the image works; it is **not** a local PASS, and it does not record the
extension versions. TD-61's remaining obligation is the workstation reproduction (condition A4).

Also unverified: `postgis/postgis:16-3.5` was rejected on the grounds that it is still
`FROM postgres:16-bullseye`. That was confirmed from the upstream `postgis/docker-postgis` repository,
which also shows the `16-3.4` variant no longer exists upstream — so the root-cause reasoning holds
even though the build does not.

## 13–16. Clean database migration cycle

Against a brand-new empty database (`quest_audit_fresh`):

| Step                           | Observed                                                                                                                                                                                                                                 |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 13. `db:migrate:status` before | `pending 0000_platform_extensions`, `pending 0001_identity_profiles`, `pending 0002_quest_core`; **exit 1** (expected on an empty database — non-zero on pending is the CI gate, asserted by the workflow as `! pnpm db:migrate:status`) |
| 14. `db:migrate` first run     | `Migrations applied: 3, pending: 0`                                                                                                                                                                                                      |
| 15. `db:migrate` second run    | `Migrations applied: 3, pending: 0` — **idempotent**                                                                                                                                                                                     |
| 16. `db:migrate:status` after  | all three `applied`, **0 pending**, exit 0                                                                                                                                                                                               |

Extensions in that database afterwards: `postgis 3.4.2`, `vector 0.6.0` — present only after
`db:migrate`, confirming migration `0000` owns `CREATE EXTENSION` and nothing pre-creates them.

## 17. Integration / E2E

**PASS — 5 files, 84 tests, 84 passed, 0 skipped, 0 failed**, against native PostgreSQL 16.13 (PostGIS

- pgvector) and Redis 7.0.15. Every mandatory suite executed; none reported 0 tests.

## 18. P02-41 / TD-48 — **PASS on the safety claim, FAIL on availability (P1-1)**

The safety half of the remediation holds. Auditor A could not find any way to see, discover or accept
a published Quest whose owner is not `ACTIVE`, across every surface tested:

| Owner state           | anon detail | member detail | discovery | accept | staff `/v1/quests/:id` | staff `/v1/admin/quests/:id` |
| --------------------- | ----------- | ------------- | --------- | ------ | ---------------------- | ---------------------------- |
| ACTIVE                | 200         | 200           | present   | 201    | 200                    | 200                          |
| SUSPENDED             | 404         | 404           | absent    | 404    | 200                    | 200                          |
| DEACTIVATED           | 404         | 404           | absent    | 404    | 200                    | 200                          |
| DELETION_REQUESTED    | 404         | 404           | absent    | 404    | 200                    | 200                          |
| DELETED (pre-cascade) | 404         | 404           | absent    | 404    | —                      | —                            |
| DELETED → ERASED      | 404         | 404           | absent    | 404    | 404                    | **200 ← P2-1**               |
| PENDING_VERIFICATION  | 404         | 404           | absent    | 404    | —                      | —                            |

404-not-403 and the no-leak claim **hold**: concealed and nonexistent bodies are byte-identical modulo
the per-request correlation id and timestamp —
`{"error":{"code":"NOT_FOUND","message":"Quest not found",…}}` in both cases, with no occurrence of the
owner's account id or of "suspend", "account", "owner" or "eligib". No 403 anywhere on the conceal
path. Fail-closed on a thrown Identity lookup confirmed by mocking the port to reject: detail 404,
absent from discovery, accept 404, owner still 200. `cancel` remains allowed (200, `CANCELLED`).
Reactivation respects the ADR-013 gate: a Quest archived before the suspension, or suspended by T&S
during it, stays 404/absent/accept-404 after reinstatement.

But the availability claim in ADR-014 — "dropping an ineligible owner's Quests shortens the underlying
read and never the page the caller receives" — is **false**. See P1-1 in §32.

## 19. ADR-014 architecture — **PARTIAL FAIL**

| Claim                                                        | Verdict                                                                                                                                                |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Quest Core does not import Identity persistence repositories | **PASS** — only the public barrel is imported (`quests.module.ts:3`, `quest.service.ts:42`, `participation.service.ts:27`, `quest-view.service.ts:14`) |
| Quest Core does not query Identity tables directly           | **PASS** — zero hits for `FROM account`, `JOIN account`, `account_role`, `account_credential` in `modules/quests/**`                                   |
| Quest Core does not duplicate Identity lifecycle policy      | **FAIL — P2-3**                                                                                                                                        |
| Never trusts client-supplied owner state or id               | **PASS** — owner is always `principal.accountId`; 12 body shapes tried, all stripped                                                                   |
| Fails closed on unknown / missing / error eligibility        | **PASS** on all four paths; one unreachable fail-open default found (P3-1)                                                                             |
| Batch lookup used for discovery                              | **PASS** — measured, see §20                                                                                                                           |
| `pnpm deps:check` mechanically enforces the boundary         | **FAIL — P2-5**                                                                                                                                        |

## 20. Discovery, N+1 and pagination

**N+1: PASS, with numbers.** Auditor B instrumented the concrete service behind the port. 14 published
Quests by 14 distinct owners (8 eligible, 6 concealed), full feed walk at `limit=2` = 4 HTTP requests:

| metric                                    | value             |
| ----------------------------------------- | ----------------- |
| `publicationEligibilityFor` (batch) calls | 9                 |
| `isPublicationEligible` (single) calls    | **0**             |
| ids per batch                             | 3,3,3,3,3,3,3,3,1 |
| bound (`requests × MAX_DISCOVERY_PASSES`) | 20                |

A per-row implementation would have made ≥14 lookups. Confirmed independently by a mutation: replacing
the batch call with a behaviourally identical per-row lookup produces 44 lookups and fails the guard
test.

**No ranking or personalisation:** PASS. `quest.repository.ts:180` orders by `desc(createdAt),
desc(id)` only; no score/weight/relevance/trending/engagement identifier anywhere in
`modules/quests/**`; later-phase modules are import-forbidden.

**Pagination: FAIL — P1-1.** Within the scan budget, pagination is clean (8/8 eligible seen exactly
once, 0 concealed leaked, 0 duplicates). Beyond it, the feed strands the catalogue. See §32.

**Block filtering is itself an N+1 — P2-4.** The batching discipline applied to Identity was not
applied to Profiles.

## 21. Participation and concurrency

New acceptance is impossible when the owner is ineligible (404, concealed). `start` and
`requestCompletion` are refused (409). `cancel` remains possible. Existing participation rows are not
erased. Every cross-context lookup is resolved before its transaction opens, so no row lock is held
across a cross-context call; lock order is quest-then-participation throughout.

The documented TOCTOU window — a suspension landing between the eligibility read and the participation
commit — was **not independently reproduced**; it needs service-level instrumentation. Taken as
designed, and its stated severity (an already-accepted participant may advance one step; no third
party gains access) is accepted as correct on the evidence available.

Two related defects found: the 409 is a behavioural oracle (P2-2), and the fail-open default (P3-1).

## 22. Publication gate regression — **FAIL (P1-2, P1-3)**

This is the most serious section of the audit, and none of it is in the remediation — it is the
original Phase 02 invariant. Auditor C found that the three layers **do not agree**, and that "a Quest
cannot be publicly available with a rejected or non-publishable decision" is false in two reachable
ways. See P1-2 and P1-3 in §32, plus P2-6 (the database layer is materially weaker than the migration
header claims).

`canonicalQuestContent` was checked field by field against everything the safety engine and acceptance
eligibility actually read: **no unhashed safety-relevant field found.** The only unhashed policy-ish
inputs are `visibility` and the availability window, on which no safety decision depends. This claim
holds.

Races that held: `assess → edit → publish` refuses both the old hash (`CONTENT_HASH_MISMATCH`) and the
new one (`SAFETY_ASSESSMENT_STALE`); six concurrent `publish ∥ safety-relevant PUT` runs never produced
a `PUBLISHED` row whose referenced assessment hash differed from its content hash or whose state was
non-publishable; a safety edit unpublishes and clears proof; `archive → republish` is refused by the
lifecycle table.

## 23. Authorization, privacy, age — **PASS**

- Ownership derives from the principal in every case; 12 request-body shapes on `POST` and 2 on `PUT`
  all stripped by the zod schemas. Every accepted row: `owner_account_id = principal`, `state=DRAFT`,
  `revision=1`, `publishedVersion=null`.
- 14 concealment probes (someone else's draft × non-existent uuid × 7 routes) all 404, all bodies
  byte-identical modulo correlation id and timestamp.
- Staff **without** `VIEW_QUEST_SUPPORT` tested by role, not by proxy: `ANALYST` and `READ_ONLY` both
  get `{detail: 404, support: 403, suspend: 403}`, while `SUPPORT`, `MODERATOR` and
  `TRUST_SAFETY_LEAD` get 200. This is the P02-05 repair holding.
- 14.7 KB of collected response bodies across owner, viewer, staff and anonymous surfaces contain no
  email, no date of birth, no coordinates, no age band.
- The **published** band governs: a declared `TEEN_13_15` Quest with a `RESTRICTED{minimumAge:18}`
  decision publishes at `ADULT`; a 14- and a 16-year-old each get 404 on detail, absence from
  discovery and 404 on accept, while an adult gets 200 and the card advertises the enforced band. The
  discovery query filters on `published_minimum_age_band`, not on the editable JSONB.
- Anonymous callers: draft 404, PRIVATE 404, UNLISTED 200 by link; `/quests/mine`,
  `/me/participations`, `/admin/quests/:id` and accept all 401.

## 24. Erasure and export — **PASS**

A unique marker was seeded into every owner-authored surface — `title`, `summary`, `instructions`,
`safety_notes`, `evidence.notes` (JSONB), `location.label`, an owner archive reason, a staff suspension
reason naming the owner, and the owner's own `completion_note` on someone else's Quest — producing 7
marker-bearing rows across four tables. After the real `AccountDeletionJob.processDue`, a union query
over `quest` text columns, both JSONB blobs, `suspension_reason`, `quest_version.content`,
`quest_audit_ledger.metadata`, `quest_participation.completion_note` and the assessment
`signals`/`restrictions` returned **zero residues**. The erased row is
`{state: ERASED, published_assessment_id: null, published_version: null, content_hash: "erased:<id>"}`;
another account's in-flight attempt is `CANCELLED`; retained assessments carry lexicon rationale only,
never user text.

Export is correctly scoped to the requesting account, and the omissions measured
(`{assessments: 2, versions: 1, ledger: 5}`) match TD-54 / P02-47 at the documented severity — **not**
re-reported as new. TD-53 confirmed by reading, with no evidence it is worse than documented.

The owner-eligibility port does not interfere with any of this.

## 25. TD-60 / multer — **PASS**

| Check                           | Result                                                                                                                                                                                                                                                |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm audit --audit-level=high` | **exit 0** — `5 vulnerabilities found / 3 moderate                                                                                                                                                                                                    | 2 high (2 ignored)` |
| Previous multer advisories      | **absent** — zero multer advisories remain                                                                                                                                                                                                            |
| Resolved multer version         | **2.3.0** (patched; advisories are `<2.3.0`)                                                                                                                                                                                                          |
| Second vulnerable copy          | **none** — one `multer@2.3.0` on disk, one lockfile entry                                                                                                                                                                                             |
| Dependency path                 | `apps/api → @nestjs/platform-express@12.0.1 → multer` — single path                                                                                                                                                                                   |
| Multipart reachability          | **none** — zero hits for `FileInterceptor`, `FilesInterceptor`, `AnyFilesInterceptor`, `FileFieldsInterceptor`, `MulterModule`, `multipart`, `UploadedFile` across `apps` and `packages`; `apps/api` imports only the `NestExpressApplication` _type_ |
| Was a parent upgrade available? | **No** — `12.0.1` is the newest `@nestjs/platform-express` and every published version pins multer to an exact version, none of them `2.3.0`. The override was the only route to the patch, and `2.2.0 → 2.3.0` is semver-minor within the same major |
| Guard test                      | `apps/api/test/dependency-pins.test.ts` fails when the override is removed — verified by removing it, re-installing (multer fell back to `2.2.0`) and observing the failure with its explanatory message. Tree restored                               |

The two remaining highs are the pre-existing documented `image-size` acceptances (TD-17), excluded via
`auditConfig.ignoreGhsas`. Three moderates remain below the gate threshold, all on dev-tooling paths
(`drizzle-kit → esbuild`, `expo → xcode → uuid`, `expo-router → query-string → decode-uri-component`).
**No new risk acceptance was created.**

## 26. Formatting — **PASS**

`pnpm format:check`: "All matched files use Prettier code style!". Both named files are clean:
`apps/api/src/modules/identity/application/account.service.ts`,
`apps/api/src/modules/quests/domain/eligibility.test.ts`. CI runs #6 and #7 failed on exactly this and
#8 passed, so the regression is both real and closed.

## 27. OpenAPI drift — **PASS**

`pnpm --filter @quest/api openapi:generate` followed by `git diff --exit-code -- docs/api/openapi`:
clean. 68 operations. `git status` after generation: clean — no unexplained modifications.

## 28. Expo — **PASS (offline fallback, not a networked pass)**

`npx expo export --platform android` (the CI target) succeeds **only with `EXPO_OFFLINE=1`**. Without
it the command fails `HTTP Proxy Network Error: Forbidden`; the egress proxy's own status endpoint
names the denied hosts (`api.expo.dev:443`, `cdp.expo.dev:443`). This is an environment restriction,
not a defect, and it is explicitly **not** recorded as a normal networked PASS. CI's `Mobile bundles
through Metro` step passes with the ordinary command.

## 29. Dependency boundary — PASS mechanically, **FAIL in substance (P2-5)**

`pnpm deps:check`: 0 violations, 247 modules, 594 dependencies. But the mechanism does not enforce what
it is believed to enforce — see P2-5.

## 30. Secret scan

CI's `Secret scan · Dependency audit` job (trufflehog `v3.97.4`, `--only-verified`, over full history)
is **green on `d19899a`**. That is the primary evidence; trufflehog is not installed in the audit
environment, so the real scanner was **not** run locally. A local pattern scan over the changed files
found nothing but a pre-existing test fixture passphrase; `.env` remains untracked. Recorded as
**PASS on CI evidence, UNABLE TO VERIFY locally**.

## 31. Phase scope — **PASS**, with one exit criterion not met

Forward check: every hit for followers/social graph, XP, levels, badges, leaderboards, crews, World
Quest, creator platform, brand monetization, AI Quest generation, recommendation/ranking and advanced
Proof AI is a _mention_, not an implementation. `FOLLOWERS` is a Phase 01 privacy enum value explicitly
stubbed until Phase 03. `badge` hits are `QuestSafetyBadge` (a safety DTO) and the discovery
participation flag. `QuestGenerationCapability` and `RecommendationRankingCapability` are Phase 00
TypeScript interfaces with zero implementations and zero callers. `world quest`, `sponsor`, `monetiz`,
`passport`, `experience_points`, `embedding`, `trending`, `forYou`: zero hits.

Reverse check against `.claude/skills/quest-phase-02-quest-core/SKILL.md`. Present and working:
lifecycle, categories, content fields, difficulty, the three-concept duration model, evidence
requirements, eligibility, the safety gate, `quest_version` snapshots, the participation state machine,
ownership/authorization, migrations, all 17 routes in the generated OpenAPI, domain events, concurrency
protection, abuse controls, observability, tests, and the create → publish → discover → accept → start
→ `COMPLETION_REQUESTED` exit path end to end.

Not implemented, all already documented: idempotency (TD-55 — no server code reads `Idempotency-Key`;
a retried `POST /v1/quests` creates a second draft); location constraints (TD-58 — stored, hashed and
assessed, but constrain nothing); discovery early-end (TD-58, now reclassified as P1-1); the
`IN_REVIEW` human clearance path (TD-38).

**One exit criterion is not met:** _"no path publishes without a fresh publishable assessment."_
Literally satisfied, defeated in spirit by P1-2 — the "fresh publishable assessment" can be
machine-minted over a human rejection.

## 32. Findings

### P1-1 — Discovery reports end-of-feed while eligible Quests remain

- **Severity** P1
- **Location** `apps/api/src/modules/quests/application/quest-view.service.ts:194-213`
  (refill loop, `MAX_DISCOVERY_PASSES = 5` at `:35`) with
  `apps/api/src/common/pagination/cursor-page.ts:53` (`hasMore` derived from survivor count)
- **Failing scenario** A run of more than `MAX_DISCOVERY_PASSES × (limit + 1)` consecutive Quests owned
  by ineligible accounts truncates the public catalogue. The loop exits on the pass bound rather than
  on data exhaustion, the scan position is a local variable and is thrown away, and the controller then
  computes `hasMore` purely from array length — so it cannot distinguish "no more rows" from "gave up
  scanning".
- **Evidence** Reproduced four times independently. Author's own direct reproduction: 3 eligible
  published PUBLIC Quests, then 18 newer Quests by suspended owners, `limit=2` →
  `rows=0 hasMore=false nextCursor=null`, and **0 of 3** eligible Quests reachable by following every
  cursor the API offers. Auditor A: 15 concealed rows, `limit=1` and `limit=2` → empty first page,
  0 of 5 reached. Auditor B: 21 concealed rows, `limit=2` → empty first page, 4 of 4 stranded, and
  `hasMore:false` on the very first request.
- **Why it matters** Triggerable by ordinary moderation: suspending a few prolific authors
  (`QUEST_MAX_ACTIVE_PER_OWNER` defaults to 50) hides the catalogue from **every** viewer, anonymous
  included, with no error and no metric. The threshold is 105 rows at the default `limit=20` and 255 at
  the maximum `limit=50`. An Identity outage triggers it globally: the batch lookup returns an empty
  map, every row is dropped, and the feed reports "no Quests, end of feed" instead of erroring.
- **Contradicts** ADR-014: "dropping an ineligible owner's Quests shortens the underlying read and
  never the page the caller receives." It is also the same failure class as audit P02-19, which this
  loop was introduced to fix — the bounded loop _bounded_ the defect rather than removing it.
- **Why existing tests miss it** The P02-41 regression test interleaves only 3 concealed rows at
  `limit=2`, comfortably inside the budget.
- **Recommended remediation** When the loop exits on `MAX_DISCOVERY_PASSES`, surface the scan position
  as `nextCursor` with `hasMore: true` — a "keep scanning from here" cursor — so concealment costs
  extra requests instead of the tail of the catalogue. Add a regression test that exceeds the budget.
- **Gate impact** Blocking.

### P1-2 — A staff suspension is undone by reinstate → re-assess → publish

- **Severity** P1
- **Location** `apps/api/src/modules/quests/application/quest.service.ts:269-277` (assess refuses only
  `SUSPENDED`/`ARCHIVED`), `:654-688` (`reinstate` → `DRAFT`, records nothing), `:312-325`
  (`publishable` computed from the new record)
- **Failing scenario** T&S suspends a Quest, writing a `HUMAN/REVIEW_REQUIRED` decision for that exact
  content hash. Staff reinstate → `DRAFT`. The owner calls `POST /v1/quests/:id/assessment` on
  byte-identical content; the deterministic engine returns `ALLOWED`, that row becomes latest by `seq`,
  and `POST /:id/publish` succeeds.
- **Evidence** End-to-end over HTTP against real staff endpoints, no SQL required:
  `reassess 200 {state:"ALLOWED",publishable:true}` → `republish 200 {state:"PUBLISHED",
publishedVersion:2}` → back in anonymous `GET /v1/quests`: **true**.
- **Why it matters** This is sanction laundering — the defect QT16 and P02-10 claim to prevent. The
  P02-37 repair closed the window only while the row is still `SUSPENDED`; after `REINSTATE` the state
  is `DRAFT` and the same two calls work. `docs/data/QUEST_DATA_MODEL.md:84-86` ("the suspension also
  records a blocking decision of its own, so the pre-suspension approval cannot be reused") is
  technically true and practically void: the owner does not reuse the old approval, they mint a new one.
- **Recommended remediation** Make a `HUMAN` blocking decision sticky per `(quest_id, content_hash)`:
  either `evaluatePublish` refuses while any `HUMAN` non-publishable decision exists for the current
  hash unless a later `HUMAN` publishable decision supersedes it, or a `RULES`/`AI` assessment may not
  supersede a `HUMAN` decision for an unchanged hash. Not another "refuse assess in state X" patch —
  that is the patch that already failed.
- **Gate impact** Blocking.

### P1-3 — A recorded non-publishable decision never takes a live Quest down

- **Severity** P1
- **Location** `apps/api/src/modules/quests/domain/eligibility.ts:79-99` (`questAccessFor` never
  consults an assessment), `apps/api/src/modules/quests/application/quest-view.service.ts:288-302`
  (`safetyBadge` reads the latest assessment for **display only**), takedown exists only as a side
  effect of the owner's own call at `quest.service.ts:329-344`; `QuestSafetyAssessed` has no consumer
  anywhere in `apps/api/src`
- **Failing scenario** A `HUMAN/REJECTED` decision is recorded for a published Quest's exact content
  hash — precisely what the Phase 14 moderation queue and the Phase 06 AI decider will do. Nothing
  happens.
- **Evidence** As a signed-in viewer: `{"questState":"PUBLISHED","detailStatus":200,
"safetyBadgeShownToViewer":{"state":"REJECTED",…},"inDiscovery":true,"acceptStatus":201}`. The API
  hands the viewer a badge reading `REJECTED` and still returns **201** on accept. Escalating to
  `ESCALATED` changes nothing. The decision chain
  `["RULES:ALLOWED","HUMAN:REJECTED","RULES:ALLOWED","RULES:ALLOWED"]` leaves the Quest `PUBLISHED`
  throughout.
- **Scope of the existing repair, verified positively** When the **engine itself** returns
  non-publishable for a live Quest, `assess()` does take it down correctly
  (`{questState:"IN_REVIEW", proofCleared:true, stillListed:false}`). So P02-09 is repaired only for
  engine-authored decisions — and because the engine is deterministic over unchanged content, that
  branch is unreachable in Phase 02 without a lexicon redeploy or a transient engine failure. Every
  other writer of a blocking decision has no enforcement point at all. P1-2 makes it worse: the
  owner's next `POST /assessment` inserts a fresh `RULES/ALLOWED` that supersedes the human rejection.
- **Not** TD-50 / P02-44, which concerns a _still-publishable_ tightening decision.
- **Recommended remediation** Make the latest decision a read-side precondition (`questAccessFor` and
  `isDiscoverable` must refuse when the latest assessment for `published_content_hash` is not
  publishable), or give the assessment write path one choke point that applies the takedown regardless
  of who recorded the decision.
- **Gate impact** Blocking.

### P2 findings

| ID   | Location                                                                                   | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ---- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P2-1 | `quest.service.ts:690-692`                                                                 | `GET /v1/admin/quests/:id` returns **200 for an ERASED Quest**, unlike `detail`, `assess` and `archive`, which all exclude `ERASED`. Observed after a real cascade: 200 with `state:"ERASED"`, the deleted account's `ownerAccountId`, and the surviving assessment's **pre-erasure content hash** — a stable fingerprint of the deleted user's content, readable after erasure. Falsifies "ERASED stays concealed even from support".                                                                                                                                                                                                                                                                                                                                                                                                                   |
| P2-2 | `participation.service.ts:371-383`                                                         | The start/completion 409 **is** an oracle for "the author's account left ACTIVE". The message string is identical to the unpublished case, but that case is unreachable: every unpublication path cancels live attempts first, so `"This Quest is no longer available"` uniquely means "the author is suspended", and `GET /v1/me/participations` confirms it (the attempt stays `ACCEPTED`/`STARTED` instead of `CANCELLED`). The claim is true of the string and false of the behaviour.                                                                                                                                                                                                                                                                                                                                                               |
| P2-3 | `quests/domain/quest.ts:137`                                                               | Quest Core keeps a **second copy of the publication-eligibility policy**: `if (input.owner.state !== 'ACTIVE') blockers.push('OWNER_NOT_ACTIVE')`, written over a raw lifecycle state handed to it by `ACCOUNT_FACTS`. Two definitions of "ACTIVE means publishable" kept in sync by hand. Directly contradicts ADR-014:57 ("Quest Core contains no mention of `SUSPENDED` at all"); `quest.test.ts:137,207` contain the literal string.                                                                                                                                                                                                                                                                                                                                                                                                                 |
| P2-4 | `quest-view.service.ts:204-207`                                                            | Block filtering is a **sequential per-row Profiles query inside the discovery loop** — up to 255 round trips per request at `limit=50`. The batching discipline applied to Identity was not applied to Profiles.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| P2-5 | `.dependency-cruiser.cjs:71-79`, `eslint.config.mjs:56`, `.dependency-cruiser.cjs:161-163` | The boundary is **not mechanically enforced against raw SQL**. A probe file injecting `DATABASE` and running `SELECT state FROM account …` with its own local policy passes `deps:check` with 0 violations and `eslint` clean; dependency-cruiser is import-graph-based and cannot see SQL. Tests are excluded from all rules. No rule can catch P2-3.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| P2-6 | `apps/api/drizzle/0002_quest_core.sql:99-108`, `:164-166`, `:74`                           | The database layer is materially weaker than the migration header claims. Direct SQL on a migrated database produced a `PUBLISHED` row while pointing `published_assessment_id` at a **REJECTED** assessment, at an assessment of **unrelated content**, and at an assessment **belonging to another Quest** (the FK is unscoped); with `published_minimum_age_band='NOT_A_BAND'` (no value CHECK); with an `ADULT → TEEN_13_15` downgrade; with `published_version = 9999`, `0` and `-5`; with `published_at` a century in the future; and with `erased_at` or `suspended_at` simultaneously set. The CHECK compares `published_content_hash` to `content_hash`, never to the assessment's hash. ADR-013 describes it accurately; the migration header and "no manual UPDATE can produce a visible Quest without publication proof" are the overclaims. |
| P2-7 | `quest.service.ts:459-473`, `participation.service.ts:411-420`, `content.ts:238`           | **Advertised terms ≠ enforced terms for a new participant.** Publish with a 2-hour window, then widen it to 500 hours as a non-safety edit: no new `quest_version`, `publishedVersion` stays 1. A participant who only ever saw "500 hours" accepts and is enforced at 2. TD-43 covers only the participant who accepted _before_ the edit and calls that correct; this case is not.                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| P2-8 | `quests.int.test.ts:1055-1091`                                                             | The test named for the P02-09/P02-22 takedown guarantee **cannot detect P1-3**. It asserts only `if (state === 'PUBLISHED') expect(published_assessment_id).not.toBeNull()` — trivially true since nothing clears it — and ends with `expect(Array.isArray(list.data)).toBe(true)`. A test carrying a safety guarantee in its name asserts nothing about it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

### P3 findings

| ID   | Location                                        | Finding                                                                                                                                                                                                                                                                                                                  |
| ---- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P3-1 | `participation.service.ts:356`                  | `let ownerEligible: OwnerEligible = true` — a **fail-open default**. If the unlocked preview cannot resolve `ownerAccountId`, the guard at `:382` becomes a no-op. Not demonstrably reachable (Quest rows are never hard-deleted), but the correct default is `false` with the "not resolvable" case handled explicitly. |
| P3-2 | `account.repository.ts:74-86`                   | Eligibility rests entirely on `state` and ignores `deletedAt`; nothing ties the two. A future path that sets `deletedAt` without moving `state` leaves content public.                                                                                                                                                   |
| P3-3 | `identity/index.ts:12`                          | `isPublicationEligibleState` — the policy predicate the port exists to keep inside Identity — is exported from the public barrel and importable by Quest Core with no violation.                                                                                                                                         |
| P3-4 | `quest_safety_assessment`, `quest_audit_ledger` | "Append-only" is unenforced: `UPDATE` and `DELETE` both succeed on the **publication-proof** table, not just the ledger. TD-47 names only `quest_audit_ledger`.                                                                                                                                                          |
| P3-5 | `packages/types/src/quest/lifecycle.ts:19-20`   | The state machine's own documentation says `ARCHIVED` keeps existing participations working; `quest.service.ts:533` withdraws them. The code is the safer behaviour; the comment is wrong.                                                                                                                               |
| P3-6 | `quests.int.test.ts:1093-1145`                  | The test titled "lets a favourable re-assessment release a Quest parked in review (P02-21)" **asserts the opposite**: it never re-calls `/assessment` and asserts `IN_REVIEW` three times. The `publishable && IN_REVIEW → REVISE` branch has no coverage at any level.                                                  |
| P3-7 | ADR-014 "Failure and reactivation"              | "The owner still sees their own Quest" holds only for `DELETION_REQUESTED`. `SUSPENDED` and `DEACTIVATED` revoke sessions and refuse sign-in, so the author's own read is an anonymous 404. Not a leak, but the claim is wrong for two of three states.                                                                  |

## 33. Test quality and mutation

Mutation evidence for the TD-48 enforcement points was produced by the implementing session and is
recorded in §7 of `PHASE_GATE_AUDIT_PHASE_02_2026-09-08.md`: reverting the concealment rule in
`questAccessFor` fails 4 integration + 3 unit tests; reverting the discovery batch filter fails 4;
reverting the participation guard fails 1; replacing the batch call with a behaviourally identical
per-row lookup fails the N+1 guard at 44 lookups. Auditor B independently confirmed the batch/N+1
guard behaves as claimed. The multer pin guard was re-verified this session by removing the override
and re-installing.

**Attribution matters here:** those four mutations were run by the party that wrote the code. They are
recorded as supporting evidence, not as independent verification.

New test-quality findings this audit: **P2-8** and **P3-6** — two integration tests named after safety
guarantees, one of which cannot detect a P1 that exists, the other asserting the opposite of its title.
These are distinct from the test-quality debt already recorded as TD-57.

Tree state after every mutation and probe: `git status --porcelain` empty, verified.

## 34. Unable to verify

| Item                                                                                                       | Why                                                                                                                                                                                         |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docker compose build --no-cache postgres` and the container's PostgreSQL/PostGIS/pgvector versions        | No container registry reachable (`registry-1.docker.io` → 403 through the egress proxy); the linked desktop VM has no Docker. CI is secondary evidence only. **Condition A4 remains open.** |
| Secret scan with the real scanner                                                                          | trufflehog not installed locally; CI's job is green on `d19899a`.                                                                                                                           |
| Expo export with the ordinary networked command                                                            | `api.expo.dev` and `cdp.expo.dev` denied by the egress proxy; passed only with `EXPO_OFFLINE=1`.                                                                                            |
| The documented participation TOCTOU window                                                                 | Needs service-level instrumentation to inject the race.                                                                                                                                     |
| `quest.core.owner_eligibility_unavailable` reaching a metrics backend                                      | The metrics port is stubbed in integration and exposed on no route.                                                                                                                         |
| `DELETED` pre-cascade and `PENDING_VERIFICATION` with a published Quest                                    | Not reachable through HTTP; forced with direct SQL. Both concealed correctly, but production reachability is an assumption.                                                                 |
| Erasure at `ERASURE_MAX_BATCHES` exhaustion (TD-53); the `truncated` boundary at exactly 1000 rows (TD-54) | Out of budget; both remain at documented severity.                                                                                                                                          |
| Phase 00 / Phase 01 open-defect status                                                                     | Taken from the record, not re-audited.                                                                                                                                                      |
| CI on the exact audited tree                                                                               | `5a05005` is unpushed; CI ran on `d19899a`, one documentation commit behind.                                                                                                                |

## 35. Remaining debt review

**Resolved and independently confirmed:** TD-60 (multer — §25), TD-62 (formatting — §26, plus CI
history), TD-61 in its CI form (§12; the workstation half is condition A4, not TD-61).

**TD-48 / P02-41 — partially resolved.** The safety objective is met (§18). The availability claim is
false (P1-1). It should not be marked RESOLVED while P1-1 stands.

**Previously recorded items, checked and left at their documented severity:** P02-42 (accept
eligibility race, TD-51); P02-43 (country allow-list fail-open, TD-49 — unchanged, still due before
Phase 06, **A5 correctly deferred**); P02-44 (tightened live restriction, TD-50 — confirmed distinct
from P1-3); P02-45 (public auth/account-state seam, TD-52); TD-53 (unbounded erasure statements);
TD-54 (export omissions); TD-55 (idempotency); TD-57 (test quality); TD-58 (location constraints and
discovery early-end — the early-end half is **reclassified as P1-1**).

**Reclassified upward by this audit:** the discovery early-end previously filed inside TD-58 as a
minor pagination note is a P1 (P1-1). Two of the P2s above (P2-1 ERASED support leak, P2-6 database
CHECK weaker than documented) are new.

## 36. Score

**62 / 100.**

The phase is well engineered in most respects: the boundary discipline is real, privacy and
authorization hold under adversarial probing, erasure is thorough, the content-hash mechanism is sound
and correctly scoped, and the remediation's safety objective is genuinely met. The score is dominated
by three P1s, two of which sit in the central safety invariant the phase exists to establish, and by a
pattern that recurs across this phase's history: **a repair that closes the reported instance of a
class without closing the class.** P02-19 became P1-1; P02-37 became P1-2; P02-09 became P1-3. Two
tests named after safety guarantees assert nothing about them.

## 37. Verdict

The gate fails on substance, independently of the provenance problem in §1.

---

OPEN P0: 0
OPEN P1: 3
OPEN P2: 8
OPEN P3: 7

A1 — Independent final audit: **FAIL** (this report was written by the implementing session; A1 is undischarged)
A2 — P02-41 owner-lifecycle remediation: **FAIL** (safety objective met; P1-1 availability defect open)
A3 — GitHub CI 6/6 green: **PASS** (run #8, `d19899a`; audited HEAD is one documentation commit ahead)
A4 — Developer-machine reproduction: **UNABLE TO VERIFY** (no container registry reachable; no local Docker build)
A5 — Country-rule deferred condition: **ACCEPTED FOR LATER PHASE** (P02-43 / TD-49, due before Phase 06)
A6 — Carried Phase 01 release conditions: **DOCUMENTED** (mail transport, minimum-age legal sign-off)

PHASE 02 SCORE: 62/100

PHASE 02 GATE:
FAIL

PHASE 03 AUTHORIZATION:
NOT AUTHORIZED

Not merged into `main`. No Phase 03 branch created. Phase 03 not started. No production code, test,
migration or dependency file was modified by this audit; the only file added is this report.
