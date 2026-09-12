# Phase 02 — FINAL independent delta audit (prompt for a FRESH session)

## Why this file exists

This prompt must be run in a session with **no implementation history**. It was issued to the
session that had just written the P02-41 remediation, which flagged the conflict rather than
running it: gate condition **A1** requires an auditor who did not write the code, and an audit of
one's own work cannot discharge it. Nothing in the repository has been certified by an independent
party yet.

**Run this in a new session. Do not run it in one that has written to this branch.**

## Branch state as of 2026-09-12 (read this before the entry checks)

Expect **HEAD = `d19899a`**. The lineage, newest first:

| Commit    | What                                                                 |
| --------- | -------------------------------------------------------------------- |
| `d19899a` | `docs(governance)` — the CI image change plus TD-61/TD-62            |
| `05d82c9` | `fix(ci): refresh postgres image for integration tests`              |
| `580a954` | `style(phase-02): normalize remediation formatting`                  |
| `1ae3567` | `docs(governance)` — this prompt                                     |
| `5fd73cc` | `fix(deps): take the patched multer through a pnpm override` — TD-60 |
| `0f2b051` | `audit(P02-41): enforce owner lifecycle on published quests` — TD-48 |

All of them were written by the same non-independent session. Audit all of them.

**GitHub CI is green, and this is verifiable without a token — the repository is public.**
`https://api.github.com/repos/mazin8j/quest-platform/commits/<sha>/check-runs` returns the six
mandatory jobs. Run **#8** on `d19899a` is **success on all six**; runs **#6** (`0f2b051`) and **#7**
(`1ae3567`) **failed**, both on formatting. Confirm this yourself rather than trusting the table, and
record the SHA CI actually tested — it must equal the audited HEAD.

Consequences you should know going in, each of which is a claim to check rather than accept:

- **A3 appears met** for `d19899a`. It was unverifiable when this prompt was first written, because
  the branch had not been pushed.
- **TD-61 (the postgres image was never built) is largely answered by CI**, not by a local run: the
  `Migrations · Integration tests` job builds `infrastructure/docker/postgres` from a fresh checkout
  and every step passed, so the `postgres:16-bookworm` + PGDG image builds, starts and serves both the
  migration cycle and the integration suite. What is genuinely outstanding is the **workstation**
  reproduction — condition A4. Expect PGDG bookworm to report newer extensions than any natively
  installed packages (PostGIS 3.5.x, pgvector 0.8.x).
- **TD-62 is confirmed by CI history**: `pnpm format:check` lives outside the turbo pipeline, so
  `turbo run lint typecheck test build` passes while CI fails. Two runs failed on it.
- The working tree carries one untracked folder, `Claude outputs/` — a desktop-app artefact, not
  repository content.
- **A1 is the only remaining blocker to Phase 03 authorization.** That is precisely why this must not
  be run by a session that wrote any of the commits above: closing the last condition by
  self-certification is the failure mode the condition exists to prevent.

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
