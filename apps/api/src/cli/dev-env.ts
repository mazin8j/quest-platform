import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Canonical development environment loading for QUEST.
 *
 * This lives in the API CLI layer, not in `@quest/config`, on purpose. It is the very first thing
 * an entry point runs, and Node resolves `@quest/*` through each package's `main` field — its
 * compiled `dist/` — not through TypeScript path mapping. A loader imported from a workspace
 * package therefore breaks whenever that package has not been rebuilt yet (the exact failure this
 * file replaces: `TypeError: import_config.loadDevEnv is not a function` from a `dist/` predating
 * the loader). Depending on nothing but Node built-ins, it works on a fresh clone before any build,
 * which is the only acceptable contract for `pnpm db:migrate` and friends.
 *
 * The repository has exactly one local configuration file: `.env` at the repository root (the
 * directory holding `pnpm-workspace.yaml`), created from `.env.example`. It is git-ignored and
 * never contains production values. Nothing in the applications reads a file: they read
 * `process.env`, which is what CI, ECS task definitions and secret injection populate. This loader
 * is the single bridge between the two, so a developer can run any repository script from any
 * directory without exporting variables by hand.
 *
 * Precedence, in order (highest first):
 *   1. variables already present in `process.env` — CI, the shell, and injected production
 *      configuration always win; the file can only fill gaps, never override;
 *   2. the file this loader applies;
 *   3. schema defaults in each application's config module.
 *
 * The loader refuses to apply anything when `NODE_ENV` is `production` or `staging`: deployed
 * environments must be configured by their platform. If a file exists there it is reported on
 * stderr rather than being ignored silently. `QUEST_SKIP_DOTENV=true` disables it everywhere;
 * `QUEST_ENV_FILE` points it at a different file (useful for a second local database).
 *
 * Documented in docs/DEVELOPER_SETUP.md ("Environment configuration").
 */

/** Directories that mark the repository root, in the order they are checked. */
const ROOT_MARKERS = ['pnpm-workspace.yaml', 'pnpm-lock.yaml'];

export interface DevEnvLoadResult {
  /** Absolute path of the file that was read, or null when none was found or none was read. */
  file: string | null;
  /** Names of the variables taken from the file (values are never reported). */
  applied: string[];
  /** Names present in the file but already set in the environment, which therefore won. */
  ignored: string[];
  /** Why nothing was applied, when nothing was. */
  skipped: 'deployed-environment' | 'disabled' | 'not-found' | null;
}

export interface LoadDevEnvOptions {
  /** Directory to start the upward search from. Defaults to `process.cwd()`. */
  cwd?: string;
  /** Environment object to read and mutate. Defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
  /** Sink for the deployed-environment warning. Defaults to `console.warn`. */
  warn?: (message: string) => void;
}

/** Parses dotenv-style text. Returns declaration order; later duplicates win, as in a shell. */
export function parseDotenv(contents: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#')) continue;
    const withoutExport = line.startsWith('export ') ? line.slice('export '.length).trim() : line;
    const eq = withoutExport.indexOf('=');
    if (eq <= 0) continue;
    const key = withoutExport.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = withoutExport.slice(eq + 1).trim();
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.length > 1 && value.endsWith(quote)) {
      value = value.slice(1, -1);
      // Escape sequences are only meaningful inside double quotes, as in a POSIX shell.
      if (quote === '"') value = value.replace(/\\n/g, '\n').replace(/\\r/g, '\r');
    } else {
      // An unquoted value ends at an inline comment introduced by whitespace + '#'.
      const comment = value.search(/\s#/);
      if (comment >= 0) value = value.slice(0, comment).trimEnd();
    }
    out[key] = value;
  }
  return out;
}

/** Walks up from `start` looking for the directory that holds a workspace marker. */
export function findRepositoryRoot(start: string): string | null {
  let dir = path.resolve(start);
  for (;;) {
    if (ROOT_MARKERS.some((marker) => existsSync(path.join(dir, marker)))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Applies the repository-root `.env` to the environment without overriding anything already set.
 * Safe and idempotent to call from any entry point; a no-op in deployed environments.
 */
export function loadDevEnv(options: LoadDevEnvOptions = {}): DevEnvLoadResult {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const warn = options.warn ?? ((message: string) => console.warn(message));
  const empty: DevEnvLoadResult = { file: null, applied: [], ignored: [], skipped: null };

  const explicit = env.QUEST_ENV_FILE;
  const root = findRepositoryRoot(cwd);
  const file = explicit
    ? path.resolve(cwd, explicit)
    : root
      ? path.join(root, '.env')
      : path.resolve(cwd, '.env');

  if (env.QUEST_SKIP_DOTENV === 'true') return { ...empty, skipped: 'disabled' };

  const nodeEnv = env.NODE_ENV;
  if (nodeEnv === 'production' || nodeEnv === 'staging') {
    if (existsSync(file)) {
      warn(
        `[config] NODE_ENV=${nodeEnv}: ignoring ${file}. Deployed environments are configured by ` +
          'their platform; local files are never applied here.',
      );
    }
    return { ...empty, skipped: 'deployed-environment' };
  }

  if (!existsSync(file)) return { ...empty, skipped: 'not-found' };

  const parsed = parseDotenv(readFileSync(file, 'utf8'));
  const applied: string[] = [];
  const ignored: string[] = [];
  for (const [key, value] of Object.entries(parsed)) {
    // `key in env` and not a truthiness test: an explicitly empty value is a deliberate choice.
    if (key in env) ignored.push(key);
    else {
      env[key] = value;
      applied.push(key);
    }
  }
  return { file, applied, ignored, skipped: null };
}
