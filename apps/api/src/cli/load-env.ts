/**
 * Entry-point hook: applies the repository-root `.env` before anything reads `process.env`.
 *
 * Every command in this folder and `main.ts` call `applyDevEnv()` as their first step, so
 * `pnpm db:migrate`, `pnpm db:migrate:status`, `pnpm db:reset:dev` and the identity/openapi
 * commands work from the repository root (or any subdirectory) with no exported variables. Real
 * environment variables always win, and nothing is applied when NODE_ENV is `production` or
 * `staging` — see `./dev-env` and docs/DEVELOPER_SETUP.md.
 *
 * Two rules keep this safe, and `apps/api/test/cli-env.test.ts` enforces both:
 *
 *  1. **Called, never imported for effect.** `migrate.ts` and `openapi.ts` are also imported as
 *     libraries (the integration harness reuses `migrateUp`, the contract test reuses
 *     `renderOpenApi`). A module that mutated `process.env` on import would silently reconfigure
 *     every test that touches it, so the work happens only when a command actually runs.
 *  2. **Dependency-free.** This file and `./dev-env` import nothing but Node built-ins. Node
 *     resolves `@quest/*` through each package's compiled `dist/`, so a bootstrap step imported
 *     from a workspace package breaks whenever that package has not been rebuilt
 *     (`TypeError: loadDevEnv is not a function`). The database CLIs must run on a fresh clone.
 */
import { type DevEnvLoadResult, loadDevEnv } from './dev-env';

let applied: DevEnvLoadResult | null = null;

/** Applies the local `.env` once per process and reports what it did. Idempotent. */
export function applyDevEnv(): DevEnvLoadResult {
  if (applied) return applied;
  applied = loadDevEnv();

  // One compact line so it is obvious where configuration came from. Never values — they are
  // secrets; `QUEST_ENV_VERBOSE=true` adds the variable names, `QUEST_ENV_QUIET=true` silences it.
  if (applied.file && applied.applied.length > 0 && process.env.QUEST_ENV_QUIET !== 'true') {
    const names = process.env.QUEST_ENV_VERBOSE === 'true' ? `: ${applied.applied.join(', ')}` : '';
    console.error(
      `[config] loaded ${String(applied.applied.length)} variable(s) from ${applied.file}${names}`,
    );
  }
  return applied;
}

/** Whether `applyDevEnv()` has run in this process (used by the regression tests). */
export function devEnvApplied(): boolean {
  return applied !== null;
}
