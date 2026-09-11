# Phase 02 — FINAL independent delta audit (prompt for a FRESH session)

## Why this file exists

This prompt must be run in a session with **no implementation history**. It was issued to the
session that had just written the P02-41 remediation, which flagged the conflict rather than
running it: gate condition **A1** requires an auditor who did not write the code, and an audit of
one's own work cannot discharge it. Nothing in the repository has been certified by an independent
party yet.

**Run this in a new session. Do not run it in one that has written to this branch.**

## Branch state as of 2026-09-11 (read this before the entry checks)

The original prompt names `0f2b051` as the expected tip. That is no longer HEAD — one further
commit landed afterwards:

| Commit    | What                                                                                 |
| --------- | ------------------------------------------------------------------------------------ |
| `0f2b051` | `audit(P02-41): enforce owner lifecycle on published quests` — the TD-48 remediation |
| `5fd73cc` | `fix(deps): take the patched multer through a pnpm override` — closes TD-60          |

Both were written by the same non-independent session. Expect **HEAD = `5fd73cc`** with `0f2b051`
as its parent, and audit both. Other facts to verify rather than trust:

- branch `phase-02-quest-core`; `main` at `e0f1d4d` (the Phase 01 merge); `phase-01-approved`
  (`26182c3`) an ancestor of HEAD; 9 commits since `main`, all Phase 02
- the working tree carries one untracked folder, `Claude outputs/` — a desktop-app artefact, not
  repository content
- the branch has **never been pushed**: the git proxy refuses `mazin8j/quest-platform` from the
  cloud sandbox and returns 403 after CONNECT from the desktop. Condition **A3 (CI green)** cannot
  be evaluated until somebody pushes from an unproxied shell
- `5fd73cc` changes `pnpm-lock.yaml`, so run `pnpm install` before anything else
- `docs/governance/PHASE_GATE_AUDIT_PHASE_02_2026-09-08.md` now has a §7 (TD-48 remediation) and a
  §8 (TD-60). §§0–6 are the original audit and were not edited. Treat §7 and §8 as **claims to be
  falsified**, not as findings

## Environment notes (from the prior session; verify, do not assume)

- Docker was unavailable there; PostgreSQL 16 + PostGIS + pgvector and Redis were run natively
- `expo export` needs `EXPO_OFFLINE=1` in a sandbox whose egress denies `api.expo.dev`; the CI
  target is `--platform android`
- `pnpm db:migrate:status` exits 1 when migrations are pending — by design, not a failure
- a `-t` name filter on the integration suite skips the migration step and produces false
  negatives; always run whole files

---

## The audit prompt

You are performing the FINAL independent delta audit for QUEST Phase 02.

Repository: `C:\Quest`
Branch: `phase-02-quest-core`

You did NOT implement the latest remediation.
The remediation commits expected on this branch are `0f2b051` (P02-41 / TD-48) and `5fd73cc`
(TD-60). Do NOT trust the remediation reports without reproducing their claims.

Primary goals:

1. independently verify that P02-41 / TD-48 is actually closed;
2. verify that Phase 02 now has OPEN P0 = 0 and OPEN P1 = 0;
3. reproduce all mandatory validation commands;
4. determine whether TD-60 is genuinely closed and whether it blocks Phase 02 approval;
5. do not start Phase 03;
6. do not merge into main.

### 1. Entry checks

Verify: current branch is `phase-02-quest-core`; working tree is clean; `main` is still the
Phase 01-approved baseline; `0f2b051` and `5fd73cc` are in HEAD ancestry; all commits since `main`
are Phase 02 only; `phase-01-approved` is an ancestor of HEAD. Stop if any entry condition fails.

### 2. Reproduce P02-41

Independently test that published Quests are correctly concealed or blocked when the owner becomes
SUSPENDED, DEACTIVATED, DELETION_REQUESTED, DELETED. Verify every affected surface: public Quest
detail, discovery, accept, start, completion request, support/admin visibility, owner self-view,
reactivation behaviour. Do not merely inspect tests — exercise the actual implementation.

### 3. Verify architecture

Verify ADR-014 and the implementation it describes. Confirm: Quest Core does not import Identity
repositories; Quest Core does not query Identity tables directly; owner lifecycle policy remains
owned by Identity; batch lookup is used for discovery; no N+1 owner-state lookup exists;
unknown/missing owner eligibility fails closed; support access does not leak ERASED content;
reactivation does not bypass the existing safety publication gate.

### 4. Test quality

Read the new regression tests. Verify that they fail if the TD-48 enforcement is removed. At
minimum, mutation-test or temporarily revert: public detail concealment; discovery owner filter;
participation owner-eligibility guard; batch lookup / N+1 protection. Also mutation-test the TD-60
guard by removing the `multer` override. Restore the implementation afterward.

### 5. Full validation

Delete the Turbo cache. Run `pnpm install --frozen-lockfile`,
`pnpm turbo run lint typecheck test build --force`, `pnpm deps:check`, and the integration/E2E suite
against real PostgreSQL and Redis. Run migrations against a brand-new empty database and verify
status before, first migrate, second migrate, status after, idempotency. Run
`pnpm --filter @quest/api openapi:generate` then `git diff --exit-code`. Run the Expo export, the
repository secret scan, and `pnpm audit --audit-level=high`. Record actual results. Do not mark a
command PASS if it could not run.

### 6. TD-60 — dependency audit

The remediation claims the four `multer@2.2.0` advisories (GHSA-wc9g-mqfw-jrwm,
GHSA-qfvm-cv95-jqjf, GHSA-535w-7cp7-47q4 high; GHSA-qvfw-j98x-7q72 low), reached only through
`@nestjs/platform-express@12.0.1`, are closed by a `pnpm-workspace.yaml` override to `multer@2.3.0`.

Independently verify: the exact advisory IDs and the dependency path; whether multer is actually
reachable by the current QUEST API (look for any FileInterceptor, multipart parser, upload route or
equivalent, and check whether the Express adapter mounts multer middleware); whether the override is
safe and whether it destabilises NestJS; whether the lockfile diff is confined to multer; whether
upgrading `@nestjs/platform-express` would have been the better route. Decide independently whether
TD-60 blocks Phase 02 approval. If the override is unsafe, say so and give the alternative.

### 7. Output

Produce `docs/governance/PHASE_02_FINAL_DELTA_AUDIT_<date>.md` containing: entry verification;
P02-41 independent reproduction; ADR-014 verification; regression-test verification; validation
command results; test counts; migration result; OpenAPI drift result; dependency-boundary result;
Expo result; secret scan result; `pnpm audit` result; TD-60 disposition; every remaining
P0/P1/P2/P3; final score; final verdict.

End with:

```
OPEN P0:
OPEN P1:
PHASE 02 GATE: PASS | PASS WITH CONDITIONS | FAIL
```

Do not merge into main. Do not start Phase 03.
