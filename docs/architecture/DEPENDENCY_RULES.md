# Dependency rules (D-08) — enforced by `pnpm deps:check`

Source of truth for tooling: `.dependency-cruiser.cjs` (errors fail CI) and `eslint.config.mjs`
(`no-restricted-imports` for AI provider SDKs).

## Layering

```
apps/*  ──may depend on──▶  packages/*          (never the reverse)
apps/a  ──never──▶  apps/b                      (share via packages only)
packages/* ──may depend on──▶ other packages/* without cycles (ai → types; api-client → types)
```

## Inside apps/api

| From                                                                          | May import                                                                                                                                                    | Must not import                                                                                                                                           |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/modules/<x>/**`                                                          | own module files; other modules **only via** `src/modules/<y>/index.ts`; `src/common/**`, `src/config/**`, `src/infrastructure/**` ports/tokens; `packages/*` | another module's `application/`, `domain/`, `infrastructure/`, `ports/`, `api/`; `app.module.ts`; `main.ts`; `@aws-sdk/*`; `ioredis`; any AI provider SDK |
| `src/common/**`, `src/infrastructure/**`, `src/config/**`, `src/telemetry/**` | `packages/*`, vendor SDKs (adapters)                                                                                                                          | anything under `src/modules/**`                                                                                                                           |
| `src/app.module.ts`, `src/bootstrap.ts`, `src/main.ts`                        | everything (composition root)                                                                                                                                 | —                                                                                                                                                         |

## Ownership & interaction (normative, reviewed)

- **Persistence ownership**: one context owns its tables and is the only writer. No shared
  "utils" tables. Migrations that touch another context's tables require that context owner's review.
- **Synchronous API rule**: cross-context calls are read-only queries through an exported port;
  they must be fast (no fan-out loops) and must not open transactions in the callee.
- **Domain-event rule**: any side effect in another context is an event reaction; handlers are
  idempotent on `eventId`; events carry ids + facts, not documents; `RESTRICTED` data never travels.
- **Shared packages**: `types` (contracts only), `config` (env primitives), `events` (envelope +
  ports + local bus), `ai` (gateway contracts + adapters), `ui` (tokens), `analytics` (contract +
  sinks), `api-client` (HTTP client). Adding runtime behaviour that belongs to one app is a smell —
  it goes in the app.
- **Clients**: mobile/web/admin never implement business rules; they call the API and render.

## Verifying

```bash
pnpm deps:check        # boundaries + cycles (0 errors required)
pnpm lint              # provider SDK restriction, type-aware rules
```
