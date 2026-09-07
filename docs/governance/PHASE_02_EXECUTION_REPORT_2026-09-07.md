# QUEST — Phase 02 Execution Report (2026-09-07)

Repository: `C:\Quest` · branch `phase-02-quest-core`, three commits ahead of `main` (`e0f1d4d`,
the merge of `phase-01-identity` through PR #1): `feat(quests)` Quest core, `fix(quests)`
adversarial-review repairs, `docs(quests)` documentation. Working tree clean · 77 files changed
(48 added, 29 modified).

Commits are named by subject rather than by hash: they were authored in a cloud workspace and
replayed onto `C:\Quest` as patches, so the hashes differ between the two repositories while the
trees are identical (both `2755777`).

## 1. Executive summary

Phase 02 implements the authoritative Quest lifecycle: draft, safety assessment, publication,
archive, staff sanction, unranked discovery, and the participation state machine through to
proof-required completion. The phase's defining decision is ADR-013: **an approval belongs to
content, not to a Quest id**, and publication is refused unless three independent layers agree — the
shared Trust & Safety rule (`canPublishWithAssessment`), the domain gate (`evaluatePublish`), and a
database CHECK (`quest_published_requires_assessment`) that no code path, migration or manual
`UPDATE` can circumvent. A safety-relevant edit rehashes the content, which makes the previous
approval stale by definition, takes the Quest out of visibility and cancels the attempts that were
accepted under it.

Phase 01 boundaries are respected mechanically, not by convention: a new dependency-cruiser rule
forbids the Quest context from reading identity or profile tables, owner facts arrive through an
Identity-owned `ACCOUNT_FACTS` port, no date of birth enters the context, and anything a caller may
not know about answers 404 rather than 403.

Four independent adversarial reviews of the implementation found **4 P0 and 20 P1 defects**. All 24
were repaired on the branch with regression tests, together with the P2 items whose fix was small
and whose risk was real. The full validation set was then re-run green.

Phase 02 is **not** authorized as complete by this report; the independent phase-gate audit decides.

## 2. What was built

**Contracts (`packages/types/src/quest/`)** — the Quest and participation state-transition tables;
the category taxonomy, difficulty, visibility and evidence vocabulary; the three-concept duration
model (effort / attempt window / availability); eligibility and the age-band helpers;
`canonicalQuestContent` and the content-hash version; and the request/response schemas for every
route. 27 unit tests.

**Events (`packages/events/src/catalog/quest.ts`)** — twelve events across the `quest` and
`quest_participation` aggregates. Payloads carry ids, hashes, states and enum categories; no Quest
text and nothing about the owner beyond an account id.

**Persistence (`apps/api/drizzle/0002_quest_core.sql`)** — six tables, thirteen CHECK constraints,
twelve indexes, the seeded category catalogue, and the publication-proof constraint. The Drizzle
mirror is complete (indexes, checks, foreign keys and defaults) because drizzle-kit computes its
next snapshot from it; an integration test compares the mirror against the migrated database so the
two cannot drift silently. Documented in `docs/data/QUEST_DATA_MODEL.md`.

**Trust & Safety** — `RuleBasedSafetyDecision` replaces the Phase 00 fail-closed placeholder: a
deterministic lexicon of ~20 rules across four severity tiers, mapped to policy states, fail-closed
on any error, on malformed input and on submissions with no assessable text. Normalisation is
NFKC-folded and strips zero-width and bidi formatting characters, so a single invisible character
cannot defeat every rule at once.

**API (`apps/api/src/modules/quests/`)** — sixteen routes: authoring, assessment, publication,
archive, discovery, detail, the category catalogue, participation, and the staff support surface.
Publication refusals are 409s listing machine-readable blockers a client can act on.

**Account lifecycle** — a new account-erasure registry runs every context's erasure inside the
Identity deletion transaction, refuses to run at all if a required contributor has not registered,
and gives each contributor an after-commit hook for its events. The Quest context contributes both
an export section and an erasure contributor.

**Clients** — `@quest/api-client` quest endpoints; four mobile screens (discovery, detail with the
accept → start → complete flow, composer, owner list with the check-then-publish flow); the admin
Quest support page with suspend and reinstate behind `SANCTION_QUEST`.

## 3. Deliberately not built

XP, badges, leaderboards, followers or any social graph, crews, World Quest, the creator platform,
brand monetization, AI Quest generation, recommendation or ranking, and evidence verification.
Discovery is `ORDER BY created_at DESC` with whitelisted equality filters and nothing else;
participation ends at `COMPLETION_REQUESTED`, which means "the participant says they did it and
evidence is now required". A dependency-cruiser rule forbids the Quest context from depending on any
later-phase context, so this stays true by construction rather than by review.

## 4. Adversarial review and repairs

Four reviews ran in parallel over the implementation — authorization and privacy; the safety gate,
fail-open paths and concurrency; the data model, migration and erasure obligations; API contract,
lifecycle and phase-scope discipline. Findings, all repaired in the `fix(quests)` commit:

| ID     | Severity | Defect                                                                          |
| ------ | -------- | ------------------------------------------------------------------------------- |
| P02-01 | P0       | A PRIVATE Quest could be accepted by anyone who knew its id                     |
| P02-02 | P0       | Assessment country restrictions recorded and never enforced                     |
| P02-03 | P0       | Owner cards leaked non-PUBLIC profiles (including 13–15s) to anonymous callers  |
| P02-04 | P0       | Erasure left owner free text in the `evidence` JSONB                            |
| P02-05 | P1       | Any staff role, including ANALYST, got owner-level read of every Quest          |
| P02-06 | P1       | Acceptance was a Quest-existence oracle (403 with reasons vs 404)               |
| P02-07 | P1       | Adults-only content was readable by minors; only the accept button was gated    |
| P02-08 | P1       | Unlocked erasure read raced `accept` onto a Quest being erased                  |
| P02-09 | P1       | A REJECTED re-assessment left a live Quest public                               |
| P02-10 | P1       | suspend → reinstate → publish reused the pre-suspension approval                |
| P02-11 | P1       | The participation expiry sweep had no production caller                         |
| P02-12 | P1       | Erasure and staff takedown took locks in opposite orders (deadlock)             |
| P02-13 | P1       | Unbounded erasure made a large account impossible to delete                     |
| P02-14 | P1       | An erased moderator's id and reason stayed on other people's Quests             |
| P02-15 | P1       | The Drizzle mirror omitted the constraints, so a regenerate would drop the gate |
| P02-16 | P1       | Export was unbounded on quests; `truncated` was wrong in both directions        |
| P02-17 | P1       | Suspension and erasure emitted no unpublish event                               |
| P02-18 | P1       | Bulk participation cancellation was silent — no event, no ledger entry          |
| P02-19 | P1       | Discovery pagination ended the feed early when block filtering removed a row    |
| P02-20 | P1       | `QuestRevised.safetyRelevantChange` was false for the commonest such edit       |
| P02-21 | P1       | `IN_REVIEW` was a dead end a favourable re-assessment could not clear           |
| P02-22 | P1       | `PUBLISHED → IN_REVIEW` left stale publication proof and stranded participants  |
| P02-23 | P1       | A sanction's reason was destroyed by reinstatement                              |
| P02-24 | P1       | `QUEST_MAX_ACTIVE_PER_OWNER` was declared and never read                        |

Also repaired from the P2 set: a malformed cursor returned 500 rather than 400; the safety engine
allowed empty text and could be defeated by one zero-width or fullwidth character; "latest
assessment" was ordered by a transaction-start timestamp and a client-generated id; an age
restriction above 18 was silently under-enforced and is now refused at publication; cards advertised
the draft age band rather than the enforced one; the mobile composer could not express an audience;
list views were N+1 on assessments.

The residual P2 items are recorded as TD-37…TD-47 in `BACKLOG.md` rather than silently dropped.

## 5. Validation

| Check                                                                 | Result                                                             |
| --------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `pnpm install --frozen-lockfile`                                      | PASS                                                               |
| `pnpm verify` (format, lint, typecheck, deps:check, test, build)      | PASS — 17/17 tasks; **275** unit tests across 12 workspaces        |
| `pnpm deps:check`                                                     | PASS — 0 violations, 246 modules, 588 dependencies                 |
| Integration + E2E on PostgreSQL 16 + PostGIS 3.4.2 + pgvector + Redis | PASS — **71** tests, incl. 35 Quest integration and 2 SDK journeys |
| Migrations from an empty database                                     | PASS — 3 applied, 0 pending                                        |
| Migration idempotency (re-run)                                        | PASS — no-op, catalogue seeded once                                |
| OpenAPI regenerate + `git diff`                                       | PASS — no drift; 67 operations                                     |
| Builds: packages, API, web, admin                                     | PASS                                                               |
| `pnpm audit --audit-level=high`                                       | PASS — same posture as Phase 01 (TD-17 exception)                  |
| Secret scan                                                           | PASS — no secrets; `.env` remains ignored                          |

Sandbox limitations, unchanged from Phase 01 and recorded rather than worked around: no Docker
daemon (PostgreSQL 16 + PostGIS + pgvector and Redis run natively instead), and Terraform provider
registries are unreachable.

Not yet executed and required before the gate closes: `expo export` for the mobile app on a machine
with Expo's network access, and a CI run for this branch across all six mandatory jobs.

## 6. Documentation

Created: `docs/adr/ADR-013-quest-publication-gate.md`, `docs/data/QUEST_DATA_MODEL.md`,
`docs/api/QUEST_API.md`, `docs/security/QUEST_THREAT_MODEL.md`,
`docs/product/PHASE_02_QUEST_ACCEPTANCE.md`, `docs/ux/PHASE_02_MOBILE_QUESTS.md`.

Updated: `ARCHITECTURE_DECISIONS.md` (ADR-013), `docs/DEVELOPER_SETUP.md` (Quest commands and the
publication flow), `docs/data/IDENTITY_DATA_MODEL.md` (the erasure cascade now runs contributors
in-transaction rather than by event subscription), `PROGRESS.md`, `BACKLOG.md`.

## 7. Known debt and blockers

Blockers: none on the branch. Conditions carried from Phase 01 remain open (CI observed green,
developer-machine reproduction, mail transport, legal sign-off on the minimum age).

New debt: TD-37 (no outbox — the pending ADR), TD-38 (no human approval path out of `IN_REVIEW`
until Phase 14), TD-39 (the lexicon is small and English-only by design; Phase 06 replaces it),
TD-40…TD-47. None is a P0 or P1.

## 8. Next command

Do not start Phase 03. The next step is the independent Phase 02 gate audit — the prompt is
`docs/governance/PHASE_02_GATE_AUDIT_PROMPT.md`.
