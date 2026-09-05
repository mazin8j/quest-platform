# ADR-009 — Monorepo tooling: pnpm, Turborepo, TypeScript 5, ESLint 9, Prettier, Vitest, dependency-cruiser, zod

## Status

Accepted (2026-09-04, Phase 00)

## Context

Four applications and seven shared packages must be installed, type-checked, linted, tested and built consistently on Windows developer machines and Linux CI, with shared contracts and enforceable boundaries.

## Decision

- **pnpm 10** workspaces (`pnpm-workspace.yaml`), `node-linker=hoisted` for React Native/Metro compatibility, lockfile committed, `--frozen-lockfile` in CI. Node 22 LTS (`.nvmrc`, `engines`).
- **Turborepo** orchestrates `build/lint/typecheck/test` with caching and `^build` dependencies; chosen over Nx because it needs no project graph plugins or generators.
- **TypeScript 5.9** strict (`tsconfig.base.json`, `noUncheckedIndexedAccess`). Packages compile to CommonJS `dist/` so NestJS, Next.js and Metro consume them uniformly.
- **ESLint 9 flat config** with typescript-eslint type-checked rules (`no-explicit-any`, `no-floating-promises`, `consistent-type-imports`), Prettier for formatting, `no-restricted-imports` for AI provider SDKs.
- **Vitest 5** everywhere; the API uses `unplugin-swc` for decorator metadata; integration tests are a separate project gated by `RUN_INTEGRATION`.
- **dependency-cruiser** enforces module/package boundaries (`pnpm deps:check`, CI-blocking).
- **zod 4** is the single schema/validation library across API config, request validation, event/AI contracts and client env.
- **`@quest/api-client`** was added beyond the original package list because the same HTTP client is needed by mobile, web and admin.

## Alternatives Considered

- **npm/yarn** — slower, weaker workspace semantics. **Nx** — heavier; unnecessary generators. **Jest** — slower, duplicate config with Vitest. **Biome** — promising but weaker type-aware rules today. **ESM-only packages** — rejected for now: NestJS CommonJS interop is simpler; revisit when Nest ESM support is default.

## Consequences

- Positive: one command (`pnpm verify`) reproduces CI; fast incremental runs; boundaries fail the build.
- Negative: hoisted layout weakens pnpm strictness (phantom dependencies possible — mitigated by depcruise and explicit `dependencies`); ESLint stays on 9 until `eslint-config-next` supports 10.

## Revisit Triggers

Metro supporting isolated pnpm layouts reliably; Nest ESM default; ESLint 10 support in the Next config; build times > 10 min in CI.
