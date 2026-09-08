# QUEST — Phase 02 Gate Audit (2026-09-08)

## 0. Provenance — read this before the verdict

**This audit was conducted by the session that implemented Phase 02.** The audit prompt opens "You
did NOT implement Phase 02". That premise is false here, and no amount of care makes it true.

What that does and does not compromise:

- **Not compromised.** The mandatory reproduction is mechanical — a test suite passes or it does
  not, a migration applies or it does not. Those numbers below were observed, not copied.
- **Partly mitigated.** The adversarial finding was delegated to three subagents with no memory of
  the implementation, working read-only from the code. Two of them independently found the same P0.
  That mechanism works, but they were briefed by the implementer.
- **Compromised.** The judgement of what to discard, and the verdict itself. An implementer knows
  where they looked and is blind where they were blind.

Because of this the verdict below carries **condition A1: an independent re-audit by a session with
no implementation history, before merge to `main` or the start of Phase 03.** This document is
evidence for that auditor, not a substitute for them.

---

## 1. Entry verification

| # | Requirement | Evidence | Result |
|---|---|---|---|
| 1 | Branch `phase-02-quest-core`, clean tree | Audited from a pristine clone of `origin/phase-02-quest-core` at `c7515bd`. Its tree hash is `6a4c343991ace5d42bad4b706262da1c2bcc179c`, byte-identical to the working tree last observed on `C:\Quest`. | **MET** (see §5) |
| 2 | `main` (`e0f1d4d`) an ancestor of HEAD; every commit in `main..HEAD` is Phase 02 | `git merge-base --is-ancestor main HEAD` → true. Range: `32e7ea2` feat(quests), `0e569de` fix(quests), `b253a16` docs(quests), `4803e7d` docs(quests), `c7515bd` docs(quests). All Phase 02. | **MET** |
| 3 | Phase 01 fully merged into `main` | `git log origin/main..origin/phase-01-identity` empty; `phase-01-identity` (`5d61dd5`) is an ancestor of `main`; `refs/pull/1/head` = `5d61dd5`. | **MET** |
| 4 | Phase 01 gate audit PASS or PASS WITH CONDITIONS, P0/P1 repaired | `docs/governance/PHASE_GATE_AUDIT_PHASE_01_2026-09-06.md:47` — "**Verdict: PASS WITH CONDITIONS (overall readiness 86/100)**"; 1 P0 + 8 P1 recorded as repaired. | **MET** |
| 5 | No Phase 00/01 P0 or P1 open | `PROGRESS.md` "Remaining P0 / P1 blockers — None." for both phases; residual items are TD-29…TD-36 (P2/P3). | **MET** |

Entry gate: **passed**, so the audit proceeded.

---

## 2. Commands run and observed results

Environment: fresh Linux container, PostgreSQL 16.13 + PostGIS 3.4 + pgvector (installed during
this audit — see §5), Redis 7.0.15, Node 22.22.2, pnpm 10.28.0. Audited from a pristine clone, not
from a pre-existing working directory.

| Command | Observed |
|---|---|
| `git clone` + tree-hash comparison | `6a4c343991ace5d42bad4b706262da1c2bcc179c` — matches the device tree exactly |
| `pnpm install --frozen-lockfile` | PASS, 33.5s, lockfile unchanged |
| `rm -rf .turbo/cache` then `pnpm verify` | PASS — 17/17 tasks; **283** unit tests across 11 workspaces |
| `pnpm deps:check` | PASS — 0 violations, 246 modules, 588 dependencies |
| Integration + E2E vs real PostgreSQL + Redis (`--force`) | PASS — **76** tests, 5 files |
| Empty DB → `status` → `up` → `status` → `up` → `status` | PASS — 3 pending → 3 applied → re-run applies nothing, status unchanged |
| `openapi:generate` + `git diff` | PASS — no drift; 58 paths / 68 operations |
| Builds: API, web, admin | PASS (inside `pnpm verify`) |
| `expo export --platform android` | PASS — 4 MB Hermes bundle, `Exported: dist` |
| Secret scan (`git grep` over the committed tree) | PASS — no matches; `.env` ignored and untracked |
| `pnpm audit --audit-level=high` | PASS (exit 0) — 3 moderate, 2 high, both high on the documented TD-17 ignore list |

**Discrepancies against the execution report.** The report claims "275 unit tests" and "67
operations"; the observed figures are **283** and **68**. Both are undercounts in the report, not
overstatements, but the report's numbers were not reproducible as written (P3-6).

---

## 3. Findings

Findings are numbered P02-34 onward, continuing the implementation review's series. All P0 and P1
findings were repaired on the branch, each with a regression test proven to fail before its repair
(§4).

### P0

**P02-34 — Account erasure silently stopped after 5,000 Quests and reported success.**
`apps/api/src/modules/quests/application/quest-account-data.service.ts:31-32,158-200`

`ERASURE_MAX_BATCHES (25) × ERASURE_BATCH (200)` capped erasure at 5,000 Quests per cascade. The
constant's comment read "the deletion job re-runs and finishes the remainder next pass". That was
false: `AccountDeletionJob.deleteAccount` claims the deletion request via `completeDeletion` and
transitions the account to `DELETED` **in the same transaction** (`account-deletion.job.ts:105-143`),
so any re-run hits `account.state !== DELETION_REQUESTED` and returns `false`. There was no next
pass, and loop exhaustion was indistinguishable from completion in the code.

The per-owner cap does not bound this: `countActiveForOwner`
(`quest.repository.ts:228-239`) counts only `DRAFT|IN_REVIEW|PUBLISHED`, so archived Quests
accumulate without limit at 20 creations/minute.

*Reproduced.* With the cap lowered to 1×10 and the original silent behaviour restored, an account
owning 250 Quests was deleted, the job reported `deleted: 1`, and **240 Quests retained their
title, summary, instructions and `evidence.notes` verbatim** — an unmet Article 17 obligation
reported as a completed deletion.

Repaired: the bound is retained (an unbounded transaction is its own failure mode — the P02-13
finding) but raised to 250 batches, and exhausting it now throws. The cascade rolls back, the
request stays `PENDING`, `processDue` counts it failed, and `quest.core.erasure_incomplete`
increments. A loud, retryable failure replaces a silent, permanent one.

**P02-35 — Owner and staff free text survived erasure inside `quest_audit_ledger.metadata`.**
`quest.service.ts:527,608,660`; migration `0002_quest_core.sql:236`

The migration asserts "Ids and enums only — never Quest text." Three writers contradict it:
`archive()` stores the owner's free-text reason (≤500 chars), `suspend()` stores the staff reason,
and `reinstate()` copies `suspensionReason` into the ledger at the moment the column is cleared.
Nothing scrubbed the ledger on erasure.

This was **introduced by the P02-23 repair** in the previous review, which moved the sanction reason
into the ledger so it would survive reinstatement, without considering erasure. The existing test at
`quests.int.test.ts` asserted only `rowCount`, never `metadata`, so it passed while a moderator's
note naming the owner sat in the row.

*Reproduced.* Before erasure the ledger contained both "Elm Street" (staff prose) and "555-0100"
(owner prose); after a completed deletion both were still present.

Repaired: `redactAuditMetadataForOwner` and `redactAuditMetadataForActor` remove the `reason` and
`liftedReason` keys via `jsonb - text[]`, in both directions — rows about the erased owner's Quests,
and rows where they were the actor. Event type, ids and counts survive, so the record that a
moderation action happened is intact and only the prose is gone.

### P1

**P02-36 — A sanction recorded *against* the erased owner's own Quest was never cleared.**
`quest-account-data.service.ts:169-191`. The erasure patch scrubbed content and cleared the
publication proof but left `suspendedAt`, `suspendedBy` and `suspensionReason`. A staff description
of that person's conduct sat beside `[erased]` text indefinitely. `clearSanctionsBy` (the P02-14
repair) handled only sanctions the account *issued*, not sanctions against it — the repair was
half-applied. Repaired by clearing all three fields (and `archivedAt`) in the erasure patch.

**P02-37 — An owner could bury a staff sanction by re-assessing a suspended Quest.**
`quest.service.ts:269` — `requireOwned`/`lockOwned` exclude only `ERASED`, so `assess()` admitted
`SUSPENDED`. A suspension writes a `HUMAN` `REVIEW_REQUIRED` decision precisely so the
pre-suspension approval cannot be reused (the P02-10 repair). But the owner could then call
`POST /assessment` while suspended; the deterministic engine returned the same `ALLOWED` it gave
before, that row became latest by `seq`, and after staff reinstatement `publish` succeeded
immediately. The P02-10 repair was defeated by an adjacent path. *Reproduced:* re-assessment
returned 200 and the subsequent publish succeeded. Repaired: `assess()` refuses `SUSPENDED` and
`ARCHIVED` with a 409.

**P02-38 — The safety engine never examined two hashed, participant-visible free-text fields.**
`quest.service.ts:276-281`. The assessment input carried title, summary, instructions and
safetyNotes only. `evidence.notes` (≤500 chars) and `location.label` (≤120 chars) are part of
`canonicalQuestContent`, are rendered to every viewer, and were never assessed. An owner could move
the dangerous sentence into the evidence note and be re-approved on byte-identical instructions, so
the claim "a valid assessment of that exact content" was false for 2 of the 10 hashed fields.
*Reproduced:* a Quest whose evidence note read "climb the fence at the abandoned building and
photograph the rooftop" was assessed `ALLOWED`. Repaired: both fields are now in the assessment
text; the same Quest now yields `REVIEW_REQUIRED` and publication is refused.

**P02-39 — Quest owner cards leaked non-PUBLIC profiles to any signed-in caller.**
`profile.service.ts:171-174`. The visibility expression ended
`(isOwner || isPublic || (viewerAccountId !== null && viewerAccountId !== undefined))`, whose third
disjunct makes `isPublic` dead for every authenticated caller. The port contract
(`profile-provisioning.port.ts:36-46`) and the method's own docstring both state that a non-PUBLIC
profile yields nulls. Any signed-in account could page `GET /v1/quests?limit=50` and enumerate the
handles and display names of PRIVATE profiles and of every 13–15-year-old author — a population
`AGE_BAND_PRIVACY_POLICY` pins to `discoverable: false`. This was **introduced by the P02-03
repair**, which fixed the anonymous case and left the authenticated one open. *Reproduced:* the
leaked handle was returned. Repaired: only the owner or a genuinely PUBLIC profile yields data. The
prior test asserted the leaked value as correct and has been corrected.

**P02-40 — The schema-parity test passed vacuously on the one object it exists to protect.**
`apps/api/test/integration/database.int.test.ts:158-186`. The test read `schema/quests.ts` as a raw
string and asserted `expect(source).toContain(row.conname)`. The file's own header comment (line 24)
names `quest_published_requires_assessment`, so deleting the entire
`check('quest_published_requires_assessment', …)` call left the substring behind. *Reproduced:* with
the check deleted from the mirror, the full suite passed **7/7**. The next `db:migrate:generate`
would then have emitted `DROP CONSTRAINT` for the database half of the publication gate. The
vacuity guards were also wrong — `>= 13` CHECKs and `>= 10` indexes against an actual 14 and 13, so
one CHECK and three indexes could vanish from the migration undetected.

(My first mutation attempt appeared to *disprove* this finding: the test failed, seemingly catching
the removal. It failed for an unrelated reason — a `-t` filter skipped the migration step, so the
constraint query hit an empty database. Recording that as a refutation would have been a false
negative. The finding is real.)

Repaired: comments are stripped before matching, names must appear as an actual
`check('…'` / `index('…'` / `uniqueIndex('…'` declaration, and the counts are exact.

### P1 — accepted, not repaired

**P02-41 — Suspending or deactivating an account leaves its published Quests fully live.**
`account.service.ts:380-413`; `eligibility.ts:70-81`; `quest.repository.ts:150-183`. Account state
is checked when *publishing* (`OWNER_NOT_ACTIVE`) but by no read path. `AccountSuspended` is emitted
and has no consumer. Staff who suspend an author for dangerous Quests must then suspend each Quest
individually — and there is no list-by-owner endpoint, so they cannot enumerate what to take down.

Not repaired here deliberately. The fix is a cross-context design choice — an event consumer, a
denormalised `owner_active` column, or a port call per read, each with different consistency and
performance consequences — and it warrants an ADR rather than a change made under audit time
pressure. It is **condition A2** below.

### P2

- **P02-42** — `accept()` evaluates block, country, age band and availability against an *unlocked*
  read; the locked re-read checks only state and version. A client omitting the optional
  `expectedPublishedVersion` while racing a republish is bound to a version its eligibility was
  never evaluated against. (`participation.service.ts:67-122`)
- **P02-43** — `effectiveCountryRules` fails **open** on disjoint allow-lists: declared `['FR']` ∩
  assessment `['DE']` = `[]`, and an empty allow-list is treated as "no restriction", making the
  Quest acceptable worldwide. Latent — the Phase 02 engine always emits empty country arrays — but
  reachable by any `HUMAN`/`AI` decision. (`domain/quest.ts:192-211`, `eligibility.ts:157-159`)
- **P02-44** — A newer, still-publishable decision that *tightens* a live Quest (e.g. `RESTRICTED`
  with `minimumAge: 18`) is recorded but never applied: `assess()` handles not-publishable and
  publishable-in-review, but the publishable-and-PUBLISHED case falls through, leaving
  `published_minimum_age_band` stale. (`quest.service.ts:309-345`)
- **P02-45** — `@Public` returns from the auth guard *before* the account-state check, so a
  deactivated staff principal keeps `canViewSupport` on `GET /v1/quests/:id`. (`auth.guard.ts:48`)
- **P02-46** — Two erasure statements remain unbounded (`deleteForAccount`, `clearSanctionsBy`),
  contradicting the batching rationale beside them.
- **P02-47** — Export omits the account's own safety assessments, version snapshots and ledger
  entries, and `truncated` false-positives at exactly 1,000 rows.
- **P02-48** — Idempotency keys are accepted by CORS and sent by the client but read by no server
  code; SKILL.md lists idempotency as Required. A retried `POST /v1/quests` duplicates the draft.
- **P02-49** — `supportView` does not exclude `ERASED`, so a tombstoned Quest's owner id and full
  assessment history stay readable to staff after deletion.
- **P02-50** — "Optional location constraints" (SKILL.md scope) is only half implemented: the
  Quest's own location is stored, hashed and assessed, but constrains nothing — acceptance is gated
  on the *viewer's* country against the owner's lists.

### P3

- **P02-51** — `ERASURE_MAX_BATCHES` exhaustion now throws, but a genuinely enormous account still
  cannot be deleted at all; it fails loudly and needs an operator. Better than silence, not a
  finished story.
- **P02-52** — `contentOf()` drops `location.label` when `countryCode` is absent, so the immutable
  version snapshot omits a field its own `contentHash` covers.
- **P02-53** — A safety-driven withdrawal emits `QuestUnpublished{reason:'REVISED'}`; consumers
  cannot distinguish a T&S takedown from an owner edit.
- **P02-54** — Several weak or tautological assertions survive: `lifecycle.test.ts:23-32` passes
  against an empty transition table; `quest.test.ts:280-285` varies only one axis;
  `content.test.ts:82-85` asserts a schema key that cannot exist; two integration assertions run
  against 404 bodies and can essentially never fail.
- **P02-55** — Mobile copy tables miss three codes the server emits
  (`SAFETY_AGE_RESTRICTION_UNSUPPORTED`, `QUEST_NOT_OPEN`, `COUNTRY_UNKNOWN`); the test iterates a
  hardcoded list rather than the server's vocabulary, so it cannot detect the gap.
- **P02-56** — Discovery pagination can still end early after `MAX_DISCOVERY_PASSES`, the same shape
  as the P02-19 finding one layer out.
- **P02-57** — The execution report's test and operation counts (275, 67) do not match the
  reproducible figures (283, 68).

### Discarded

- *"Erasure has a lock-order inversion."* `deleteForAccount` and `clearSanctionsBy` do run before
  the ordered quest lock, but I could not construct a deadlock that the existing quest→participation
  ordering does not already prevent, and did not reproduce one. Recorded as unproven, not as a
  finding.
- *"Phase scope creep."* Searched and clean — see §4.

---

## 4. Verified clean

- **Publication gate.** Every writer of `state` traced repo-wide: only `QuestRepository` touches the
  table, and `PUBLISHED` is written only by `publish()` behind `evaluatePublish`, from `DRAFT` only.
  Assess→publish TOCTOU is closed by a content-hash re-check under the lock. The database CHECK
  rejects both `UPDATE` and `INSERT` attempts (tested).
- **Hash coverage.** All 16 hashable fields of `questContentSchema` are in `canonicalQuestContent`;
  the only owner-changeable unhashed fields are `visibility` and the four duration fields, none of
  which is an input to a safety decision. Unknown keys are stripped by zod.
- **Ownership.** No request schema carries an owner or a state; every mutation re-reads under
  `FOR UPDATE` and compares against the principal.
- **404-not-403.** Traced route by route, including participation and admin. All six concealment
  reasons render the identical envelope.
- **Staff permissions.** `canViewSupport` is `hasPermission(…, VIEW_QUEST_SUPPORT)`, not "is staff";
  ANALYST and READ_ONLY are correctly refused.
- **Age gating.** The published band governs; discovery filters on it in SQL; loosening it
  post-publication changes the hash and unpublishes.
- **Phase scope.** Repo-wide search for followers/XP/badges/leaderboards/crews/World Quest/creator
  platform/brand monetization/AI generation/ranking found no Phase 02 creep. Discovery is
  `ORDER BY created_at DESC, id DESC` with whitelisted equality filters — no score, no popularity
  term. Every SKILL.md scope and exit clause is implemented except idempotency (P02-48) and the
  half-implemented location constraint (P02-50).
- **Drizzle mirror content.** Object-by-object comparison found the mirror itself faithful — all 6
  tables, every column, all 14 CHECKs, all 13 indexes with partial `WHERE` and `DESC`, every FK with
  `ON DELETE RESTRICT`. The defect was the test (P02-40), not the mirror.
- **Migration** applies from empty and is idempotent; **no OpenAPI drift**; **no secrets**.

### Mutation testing of the repairs

Each repair was reverted individually and its regression test re-run. All seven failed with the
expected assertion, confirming the tests are load-bearing rather than decorative:

| Repair | Failure observed when reverted |
|---|---|
| P02-34 | `expected '240' to be '0'` — 240 Quests survived a "successful" deletion |
| P02-35 | `expected …metadata… not to contain 'Elm Street'` |
| P02-36 | `expected 'Describes this owner conduct in detail' to be null` |
| P02-37 | `expected 200 to be 409` — re-assessment of a suspended Quest succeeded |
| P02-38 | `expected 'ALLOWED' to be 'REVIEW_REQUIRED'` |
| P02-39 | `expected 'quiet_author' to be null` |
| P02-40 | `CHECK quest_published_requires_assessment is not declared in the schema mirror` |

---

## 5. What I could not verify

- **Device working-tree cleanliness at audit time.** `C:\Quest`'s Linux VM failed to start
  mid-session, so `device_bash` was unavailable. I verified the tree clean immediately before it
  died, and the audited clone's tree hash matches that state exactly — but I could not re-confirm it
  during the audit itself.
- **The environment was not the developer's.** PostGIS and pgvector were absent from the audit
  container and installed during the audit. The first integration run failed on that alone. This
  says nothing about the code, but it means "passes on a clean machine" is verified for *this*
  container, not for `C:\Quest`.
- **CI across the six mandatory jobs.** Not run — the branch has no pull request.
- **Real concurrency at scale.** Races were reasoned about and, where reproduced, reproduced with
  hand-driven transactions. No load or fuzz testing was performed; P02-42 is argued from code, not
  demonstrated.
- **Anything my own blind spots cover.** Stated plainly because it is the reason for condition A1.

---

## 6. Verdict

**PASS WITH CONDITIONS — 79/100.**

The publication gate holds under attack: I could not produce a `PUBLISHED` row without a valid,
fresh, publishable assessment by any API sequence, race, or direct SQL that satisfies the
constraints. Ownership, concealment, age gating and phase discipline are sound. The reproduction is
green end to end, including the Expo export the execution report listed as unrun.

The score is held down by what the audit found rather than by what works. Two P0s and four P1s were
live on a branch whose execution report claimed all P0/P1 findings were repaired — and three of
them (P02-35, P02-36, P02-39) were *introduced or left half-finished by the previous round of
repairs*. That is the signature of a review that verified its fixes existed rather than that they
were complete. P02-40 compounds it: the test written to protect the publication gate's database
half did not protect it, and would have reported success forever.

### Conditions

- **A1 — Independent re-audit.** This audit was conducted by the implementer (§0). A session with no
  implementation history must repeat it before merge to `main` or the start of Phase 03. This is the
  binding condition; the rest are ordinary.
- **A2 — P02-41** (suspended owner's Quests stay live) must be resolved with an ADR recording the
  chosen mechanism, before any public sign-up.
- **A3 — CI green** across all six mandatory jobs for this branch.
- **A4 — Reproduce on the developer machine**: `pnpm install --frozen-lockfile && pnpm verify`, plus
  the integration suite against local infrastructure.
- **A5 — P02-43** (country allow-list fails open) must be closed before any `HUMAN` or `AI` decider
  can set country restrictions, i.e. before Phase 06.
- **A6 —** Phase 01's open conditions carry forward: mail transport before public sign-up, and legal
  sign-off on the minimum-age assumption.

### Post-repair validation

| Check | Result |
|---|---|
| `pnpm verify`, cache deleted | PASS — 17/17 tasks, **283** unit tests |
| Integration + E2E vs real PostgreSQL + Redis | PASS — **76** tests (5 new regression tests) |
| `pnpm deps:check` | PASS — 0 violations |
| Migrations empty → apply → idempotent re-apply | PASS |
| OpenAPI drift | PASS — none |
| Expo export | PASS |
| `pnpm audit --audit-level=high`, secret scan | PASS |

Not merged into `main`. Phase 03 not started.
