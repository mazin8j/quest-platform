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
RUN_INTEGRATION=true DATABASE_URL=postgresql://quest:quest@localhost:5432/quest pnpm --filter @quest/api test:integration
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

| Symptom                                            | Fix                                                                                    |
| -------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `ERR_PNPM_UNSUPPORTED_ENGINE`                      | use Node 22 (`nvm use`)                                                                |
| API exits with `Invalid environment configuration` | the message lists the offending variables; compare with `.env.example`                 |
| `/ready` returns 503                               | `docker compose ps` — postgres/redis unhealthy; `pnpm infra:up` waits for health       |
| Migration status shows pending after `db:migrate`  | ensure `DATABASE_URL` points to the same DB; run `pnpm db:migrate:status`              |
| Metro cannot resolve a workspace package           | run `pnpm build` (packages emit `dist/`), then restart Expo with `--clear`             |
| Vitest decorator errors in the API                 | `unplugin-swc` must be installed (`pnpm install`); do not run tests with plain esbuild |
| ESLint "requires type information"                 | run from the workspace (`pnpm lint`), not from an editor with a stale tsconfig         |
| Windows line-ending diffs                          | `git config core.autocrlf false` — `.gitattributes` enforces LF                        |
