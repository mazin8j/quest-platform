/**
 * Side-effect entry hook: applies the repository-root `.env` before anything reads `process.env`.
 *
 * Every CLI in this folder and `main.ts` import this first, so `pnpm db:migrate`,
 * `pnpm db:migrate:status`, `pnpm db:reset:dev` and the identity/openapi commands work from the
 * repository root (or any subdirectory) with no exported variables. Real environment variables
 * always win, and nothing is applied when NODE_ENV is `production` or `staging` — see
 * `loadDevEnv` in `@quest/config` and docs/DEVELOPER_SETUP.md.
 *
 * `apps/api/test/cli-env.test.ts` asserts that every CLI keeps this import, so a new command
 * cannot reintroduce the "DATABASE_URL is required" trap.
 */
import { loadDevEnv } from '@quest/config';

const result = loadDevEnv();

// One compact line so it is obvious where configuration came from. Never values — they are
// secrets; `QUEST_ENV_VERBOSE=true` adds the variable names, `QUEST_ENV_QUIET=true` silences it.
if (result.file && result.applied.length > 0 && process.env.QUEST_ENV_QUIET !== 'true') {
  const names = process.env.QUEST_ENV_VERBOSE === 'true' ? `: ${result.applied.join(', ')}` : '';
  console.error(
    `[config] loaded ${String(result.applied.length)} variable(s) from ${result.file}${names}`,
  );
}

export { result as devEnvLoadResult };
