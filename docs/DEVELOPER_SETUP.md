# QUEST developer setup

## Prerequisites

| Tool                 | Version             | Notes                                                                                                                             |
| -------------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Node.js              | **22.x** (`.nvmrc`) | `engines` enforces >=22 <23                                                                                                       |
| pnpm                 | **10.28**           | `corepack enable && corepack prepare pnpm@10.28.0 --activate` (the `packageManager` field pins it)                                |
| Docker Desktop       | current             | required for PostgreSQL/Redis/MinIO (`docker compose`) — **BLOCKED_BY_LOCAL_PREREQUISITE: Docker Desktop** on machines without it |
| Git                  | any recent          | repository must be a git checkout; `.gitattributes` normalises LF                                                                 |
| Terraform            | 1.9.x               | only for infrastructure work (`terraform fmt/validate`)                                                                           |
| Expo Go / simulators | Expo SDK 57         | for running the mobile app                                                                                                        |

Windows: use PowerShell or Git Bash; all scripts are cross-platform (no `rm -rf`, no bash-only steps).

## Install

```bash
git clone <repo> quest && cd quest
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env            # local defaults; edit if ports clash
```

## Environment configuration (canonical)

There is exactly **one** local configuration file: **`.env` at the repository root**, copied from
`.env.example`. It is git-ignored, holds local values only, and is never committed. Every
repository script loads it through one mechanism — `loadDevEnv()` in `apps/api/src/cli/dev-env.ts`,
applied by `applyDevEnv()` (`apps/api/src/cli/load-env.ts`), which every command and `main.ts` call
as their first step — so commands work from the repository root or any subdirectory with nothing
exported by hand:

```bash
pnpm db:migrate                 # no `export DATABASE_URL` needed
pnpm db:migrate:status
pnpm db:reset:dev
pnpm --filter @quest/api dev
```

Each run prints one line naming the file it loaded (`QUEST_ENV_VERBOSE=true` adds the variable
names, `QUEST_ENV_QUIET=true` silences it). Values are never printed.

The loader is _called_ by each command, never applied by importing a module: `migrate.ts` and
`openapi.ts` are also imported as libraries (by the integration harness and the OpenAPI contract
test), and a module that reconfigured the process on import would silently change the environment
of every test that touches it.

The loader lives in the API CLI layer and imports **nothing but Node built-ins** — deliberately.
Node resolves `@quest/*` through each package's compiled `dist/`, not through the TypeScript path
mapping, so a bootstrap step imported from a workspace package fails on a fresh clone or whenever
that package has not been rebuilt (`TypeError: loadDevEnv is not a function`). Keeping it
dependency-free means `pnpm db:migrate` works before `pnpm build` has ever run. CLIs that boot the
Nest application (`identity:*`, `openapi:generate`) do need built packages — run `pnpm build`
first.

**Precedence — highest first:**

| Source                                       | Wins over        | Where it comes from                                          |
| -------------------------------------------- | ---------------- | ------------------------------------------------------------ |
| Variables already in the process environment | everything below | your shell, CI job env, ECS task definition, Secrets Manager |
| The root `.env`                              | schema defaults  | your machine only                                            |
| Schema defaults in `apps/*/src/config`       | —                | the code                                                     |

The file can only **fill gaps**: a variable already present in the environment — including one
deliberately set to an empty string — is never overwritten, so CI and injected production
configuration always take precedence.

**Deployed environments never read a file.** With `NODE_ENV=production` or `staging` the loader
applies nothing; if a file is present it says so on stderr rather than ignoring it silently.
Configuration there comes from the platform.

Escape hatches: `QUEST_SKIP_DOTENV=true` disables the loader entirely; `QUEST_ENV_FILE=<path>`
points it at a different file (for example a second local database). Docker Compose reads the same
root `.env` for its own variable substitution, which is why one file at the root is the rule.

## Local infrastructure

```bash
pnpm infra:up                   # docker compose up -d --wait (postgres+postgis+pgvector, redis, minio + bucket init)
pnpm infra:config               # validate compose file only
pnpm infra:down                 # stop (volumes kept); `docker compose down -v` wipes data
```

MinIO console: http://localhost:9001 (quest-local / quest-local-secret — local only).

## Database

```bash
pnpm db:migrate                 # apply pending SQL migrations (apps/api/drizzle)
pnpm db:migrate:status          # list applied/pending; exit 1 when pending
pnpm db:reset:dev               # DROP + CREATE + migrate — refuses non-local hosts and production/staging
pnpm --filter @quest/api db:migrate:generate --name <slug>   # scaffold an empty SQL migration
```

## Integration tests

```bash
pnpm infra:up
RUN_INTEGRATION=true \
  DATABASE_URL=postgresql://<user>:<password>@localhost:5432/quest \
  REDIS_URL=redis://localhost:6379 \
  pnpm test:integration
```

Run it through the **root** script (or `pnpm turbo run test:integration --filter=@quest/api`).
Workspace packages resolve through their compiled `dist/`, and Turbo's `test:integration` task
depends on `^build`, so it builds exactly the API's workspace dependencies first — `@quest/types`,
`@quest/config`, `@quest/events`, `@quest/ai`, `@quest/api-client` — and nothing else. On a fresh
clone `pnpm --filter @quest/api test:integration` cannot work on its own (`Failed to resolve entry
for package "@quest/types"`); `pnpm build:deps:api` prepares those packages if you want to use the
package script directly. The CI integration job deletes any `dist/` before it runs, so this stays
true.

Both variables are required — a missing one fails immediately with this command rather than timing
out against an unreachable port. Everything else the suites depend on is pinned by
`apps/api/test/setup.integration.ts`, so a local `.env` cannot change what they measure.

`DATABASE_URL` is the **base** connection: each suite creates and migrates a database of its own
(`quest_it_<test file>`) so the files can keep running in parallel without racing over one schema.
The test role therefore needs permission to create databases — the compose service and the CI
service both have it. Details and the suite → database table: `apps/api/test/integration/README.md`.

## Identity (Phase 01)

```bash
# .env: AUTH_JWT_SECRET (>= 32 chars), AUTH_FAKE_PROVIDER_ENABLED=true, AUTH_DEV_EXPOSE_CODES=true
pnpm --filter @quest/api identity:grant-role -- <accountId> SUPER_ADMIN   # bootstrap the first staff account (CLI only)
pnpm --filter @quest/api identity:process-deletions                        # execute due account deletions (30-day grace)
pnpm --filter @quest/api identity:process-exports                          # fulfil data-export requests
pnpm --filter @quest/api openapi:generate                                  # regenerate docs/api/openapi/v1.json (CI drift check)
```

Verification and password-reset codes are printed by the `log` mailer when `AUTH_DEV_EXPOSE_CODES=true`
(never in production). Provider sign-in locally: `provider: "FAKE"`, `idToken: "fake:<subject>:<email>"`.
Staff sign in to the admin console (http://localhost:3001/sign-in) with an account that holds a staff role.

## Quests (Phase 02)

```bash
# .env: QUEST_ASSESSMENT_MAX_AGE_DAYS (default 30), QUEST_MAX_ACTIVE_PER_OWNER (default 50)
pnpm --filter @quest/api quests:process-expiries   # expire attempts past their completion window
```

A Quest becomes visible only through `POST /v1/quests/:id/publish`, and only after
`POST /v1/quests/:id/assessment` has recorded a publishable decision about that exact content. A
refusal is a 409 whose body lists machine-readable blockers — `NO_SAFETY_ASSESSMENT`,
`SAFETY_ASSESSMENT_STALE`, `CONTENT_HASH_MISMATCH` and the rest are documented in
`docs/api/QUEST_API.md`. Editing a safety-relevant field changes the content hash, which
unpublishes the Quest and voids the approval by design (ADR-013).

The expiry sweep is idempotent; a scheduled worker replaces the command with the first deployment
(BACKLOG TD-21). Staff Quest support lives at http://localhost:3001/quests and needs
`VIEW_QUEST_SUPPORT` (SUPPORT, MODERATOR, TRUST_SAFETY_LEAD, SUPER_ADMIN).

## Run

```bash
pnpm --filter @quest/api dev        # http://localhost:4000  → /health /ready /v1/system/info
pnpm --filter @quest/web dev        # http://localhost:3000
pnpm --filter @quest/admin dev      # http://localhost:3001
pnpm --filter @quest/mobile dev     # Expo dev server; press i / a, or scan with Expo Go
```

Mobile talks to the API at `EXPO_PUBLIC_API_BASE_URL` (default localhost:4000 — on a physical
device set it to your machine's LAN IP).

## Quality gates (same commands as CI)

```bash
pnpm format:check   # prettier
pnpm lint           # eslint (type-aware)
pnpm typecheck      # tsc per workspace
pnpm deps:check     # dependency-cruiser boundary rules
pnpm test           # vitest unit tests (all workspaces)
pnpm build          # packages (tsc), api (tsc), web/admin (next build)
pnpm verify         # all of the above in order
RUN_INTEGRATION=true DATABASE_URL=postgresql://quest:quest@localhost:5432/quest REDIS_URL=redis://localhost:6379 pnpm --filter @quest/api test:integration   # migrations + identity suite + SDK E2E (drops the public schema!)
pnpm --filter @quest/mobile exec expo export --platform android --output-dir /tmp/expo-out   # Metro bundle check
```

## Repository map

```
apps/{api,web,admin,mobile}   applications
packages/{types,config,events,ai,ui,analytics,api-client}   shared libraries
infrastructure/{docker,terraform}   local image + AWS baseline
docs/{architecture,api,security,data,adr,governance,roadmap,product}   documentation
.claude/{agents,skills}       Claude development pack (phase commands, specialist agents)
```

## Troubleshooting

| Symptom                                            | Fix                                                                                                                                    |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `ERR_PNPM_UNSUPPORTED_ENGINE`                      | use Node 22 (`nvm use`)                                                                                                                |
| API exits with `Invalid environment configuration` | the message lists the offending variables; compare with `.env.example`                                                                 |
| `/ready` returns 503                               | `docker compose ps` — postgres/redis unhealthy; `pnpm infra:up` waits for health                                                       |
| Migration status shows pending after `db:migrate`  | ensure `DATABASE_URL` points to the same DB; run `pnpm db:migrate:status`                                                              |
| `DATABASE_URL is required` from a `db:*` command   | no root `.env` (`cp .env.example .env`), or `QUEST_SKIP_DOTENV=true` is set — see "Environment configuration"                          |
| `TypeError: ... is not a function` from a CLI      | stale workspace `dist/`: run `pnpm build`. The environment loader itself is dependency-free, so this can only come from another import |
| Metro cannot resolve a workspace package           | run `pnpm build` (packages emit `dist/`), then restart Expo with `--clear`                                                             |
| Vitest decorator errors in the API                 | `unplugin-swc` must be installed (`pnpm install`); do not run tests with plain esbuild                                                 |
| ESLint "requires type information"                 | run from the workspace (`pnpm lint`), not from an editor with a stale tsconfig                                                         |
| Windows line-ending diffs                          | `git config core.autocrlf false` — `.gitattributes` enforces LF                                                                        |
