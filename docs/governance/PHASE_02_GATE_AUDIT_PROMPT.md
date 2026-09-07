# Independent Phase 02 Gate Audit — prompt

Issue the text below, verbatim, to a **fresh session** with no memory of the Phase 02
implementation. Do not summarise it, do not paste the execution report alongside it, and do not
answer any of its questions on the auditor's behalf.

---

You are performing an **independent adversarial gate audit** of QUEST Phase 02 — Quest Core.

You did NOT implement Phase 02. Someone else did, and they may be wrong, mistaken, or writing
comments that describe intent rather than behaviour. **DO NOT TRUST THE PHASE 02 EXECUTION REPORT
WITHOUT REPRODUCING ITS CLAIMS.** A claim in `docs/governance/PHASE_02_EXECUTION_REPORT_2026-09-07.md`
is a hypothesis to test, not evidence. The same applies to every code comment, every doc, and every
test name: a test that asserts the wrong thing passes just as loudly as one that asserts the right
thing.

Repository: `C:\Quest`, branch `phase-02-quest-core`.

## Entry verification

Before auditing anything, independently confirm from repository evidence:

1. the branch is `phase-02-quest-core` and the working tree is clean;
2. commit `8db7fae` (the Phase 01 baseline) is an ancestor of HEAD;
3. Phase 01 is fully merged into `main` and `git log main..phase-01-identity` is empty;
4. the Phase 01 gate audit recorded PASS or PASS WITH CONDITIONS, and its P0/P1 findings were
   repaired;
5. no Phase 00 or Phase 01 P0 or P1 defect is open.

If any of these fails, stop and report it rather than auditing.

## What Phase 02 claims to be

Read `.claude/skills/quest-phase-02-quest-core/SKILL.md` for the authoritative scope and exit
conditions. In summary, a user should be able to create a Quest, pass the safety publish gate,
publish it, discover it in a basic non-ranked list, accept it, start it, and reach a proof-required
completion state — with a state-transition table, domain events, idempotency and concurrency
protection, and no path that publishes without a fresh publishable assessment.

## Mandatory reproduction

Reproduce, do not read about:

- `pnpm install --frozen-lockfile`, then `pnpm verify` **with the Turborepo cache deleted**
  (`rm -rf .turbo/cache` and `--force`), so you are not reading a replayed result;
- the integration and E2E suites against a **real** PostgreSQL and Redis;
- migrations applied to a **brand-new empty database**, then applied again to prove idempotency,
  with `db:migrate:status` before and after;
- `pnpm --filter @quest/api openapi:generate` followed by `git diff` — prove there is no drift;
- builds for API, web, admin, and an Expo export for mobile;
- `pnpm deps:check`;
- a secret scan and `pnpm audit --audit-level=high`.

Record the actual numbers you observe. If a command cannot run in your environment, say so
explicitly rather than reporting the report's numbers.

## Adversarial focus

Assume the implementation is wrong. In particular, try to break these.

**The publication gate.** The claim is that a Quest can never become visible without a valid,
fresh, publishable assessment of that exact content, enforced in three layers. Find a sequence of
API calls, a race, or a direct SQL statement that produces a `PUBLISHED` row without one. Check the
TOCTOU windows between assess and publish, between publish and edit, and around archive, suspend,
reinstate and erase. Check whether every safety-relevant field is actually in
`canonicalQuestContent` — a field an owner can change that a policy decision depends on but that
does not change the hash would let an approval survive a meaningful edit.

**Authorization and concealment.** Ownership must come from the principal and never from a request
body. Anything a caller may not know exists must answer 404, not 403 — check every route, including
participation and the admin surface, and check that error bodies do not leak what the status code
conceals. Try to read or act on another account's Quest. Try to use a staff role that does not hold
`VIEW_QUEST_SUPPORT`.

**Age and audience.** The claim is that the _published_ age band governs everything and that an
age-gated Quest is hidden rather than merely unacceptable. Try to read an adults-only Quest's
instructions as a 14-year-old and as an anonymous caller, through detail, discovery, participation
and the export bundle. Try to loosen the band by editing the draft eligibility after publication.

**Privacy.** No date of birth, email, precise location or another account's private profile data may
leave the Quest context. Check what owner cards return for PRIVATE profiles and for minors, to
anonymous and to signed-in callers.

**Erasure and export.** After an account is deleted, find any row anywhere in the quest tables that
still contains that person's content or identifies them — including JSONB blobs, version snapshots,
free-text notes on other people's participations, the audit ledger, and sanctions they issued as
staff. Check that the export contains everything about that account and nothing about anyone else,
and that its truncation reporting is honest. Check whether a very large account can actually be
deleted.

**Concurrency.** Every mutation that depends on current state should decide under a row lock in the
same transaction. Look for read-then-write races in publish, update, assess, accept, start, cancel,
suspend and the erasure path, and for lock-order inversions between them. Check that the background
sweeps are idempotent and that events cannot describe state that was rolled back.

**Phase scope.** The following were explicitly forbidden: followers or any social graph, XP, badges,
leaderboards, crews, World Quest, the creator platform, brand monetization, AI Quest generation,
recommendation or ranking, and advanced Proof AI. Search for any of them creeping in — including a
ranked discovery query, a score, or a counter that is really a leaderboard. Then check the reverse:
read the SKILL.md scope and exit lines clause by clause and find what is _missing_.

**The database as a source of truth.** Compare the hand-written migration against the Drizzle
mirror. A mirror that omits an index or a CHECK causes the next generated migration to drop it.
Verify the claim that a test now catches this, and verify that the test would actually fail if the
mirror lost a constraint.

**Tests.** Read the assertions, not the names. Find tests that would pass if the behaviour they
describe were broken, tests that assert the implementation rather than the requirement, and
behaviour with no test at all. The Phase 02 review claims 4 P0 and 20 P1 defects were repaired with
regression tests — verify that each repair has a test, and that each test fails when the repair is
reverted.

## Output

Produce `docs/governance/PHASE_GATE_AUDIT_PHASE_02_<date>.md` containing:

1. entry verification, with the evidence for each item;
2. every command you ran and its actual output summary;
3. findings, ranked P0 / P1 / P2 / P3, each with file:line, a concrete failing scenario, and the
   evidence you used to confirm it — discard anything you could not substantiate;
4. a verdict: PASS, PASS WITH CONDITIONS, or FAIL, with a score out of 100 and the conditions
   spelled out;
5. what you were unable to verify, and why.

Repair every P0 and P1 you find, on the branch, each with a regression test that fails before the
repair. Then re-run the full validation set and record it.

Do not merge into `main`. Do not start Phase 03.
