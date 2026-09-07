import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadDevEnv, parseDotenv } from '../src/cli/dev-env';
import { applyDevEnv, devEnvApplied } from '../src/cli/load-env';
// Imported for their side effects on purpose: loading these modules must change nothing.
import '../src/cli/migrate';
import '../src/cli/openapi';
import { loadAppConfig } from '../src/config/app-config';

/**
 * Guards the developer-environment contract for command-line entry points. Two regressions live
 * here, both real:
 *
 *  1. `pnpm db:migrate:status` failing with `DATABASE_URL is required` despite a root `.env`,
 *     because nothing loaded that file;
 *  2. `TypeError: import_config.loadDevEnv is not a function`, because the loader was imported
 *     from `@quest/config`, which Node resolves through a compiled `dist/` that predated it.
 */
const CLI_DIR = path.resolve(__dirname, '..', 'src', 'cli');
const LOADER = 'load-env.ts';
/** The loader itself and its implementation are not CLI entry points. */
const LOADER_FILES = new Set([LOADER, 'dev-env.ts']);

describe('CLI environment loading', () => {
  const entryPoints = readdirSync(CLI_DIR).filter((f) => f.endsWith('.ts') && !LOADER_FILES.has(f));

  it('finds the CLI entry points', () => {
    expect(entryPoints).toEqual(
      expect.arrayContaining(['migrate.ts', 'reset-dev-db.ts', 'openapi.ts', 'identity.ts']),
    );
  });

  it.each(entryPoints)('%s applies the environment before it does any work', (file) => {
    const source = readFileSync(path.join(CLI_DIR, file), 'utf8');
    expect(source, `${file} must import applyDevEnv from './load-env'`).toContain(
      "import { applyDevEnv } from './load-env'",
    );
    expect(source, `${file} must call applyDevEnv()`).toContain('applyDevEnv();');
  });

  it('is applied by the API entry point as well', () => {
    const main = readFileSync(path.resolve(__dirname, '..', 'src', 'main.ts'), 'utf8');
    expect(main).toContain("import { applyDevEnv } from './cli/load-env'");
    expect(main).toContain('applyDevEnv();');
  });

  describe('loader contract', () => {
    it('exports applyDevEnv and loadDevEnv as callable functions', () => {
      expect(typeof loadDevEnv).toBe('function');
      expect(typeof applyDevEnv).toBe('function');
    });

    /**
     * Importing a CLI as a library must not reconfigure the process. `migrate.ts` exports
     * `migrateUp`, which the integration harness uses; when the loader ran on import it applied the
     * developer's `.env` to every integration worker and broke 23 tests through settings they
     * never asked for.
     */
    it('importing a CLI module as a library changes nothing', () => {
      // `migrate.ts` and `openapi.ts` are imported at the top of this file.
      expect(
        devEnvApplied(),
        'importing a CLI must not apply the local .env — only running one may',
      ).toBe(false);
    });

    it('runs the real CLI end to end: the loader executes and the documented policy applies', () => {
      // The stale-`dist/` regression died at import time with `is not a function`. Spawning the
      // actual command covers the whole contract: resolution, execution, and the documented
      // behaviour when no configuration exists (exit 2, a message naming the fix, no values).
      const result = spawnSync(
        process.execPath,
        ['--import', 'tsx', path.join(CLI_DIR, 'migrate.ts'), 'status'],
        {
          cwd: path.resolve(__dirname, '..'),
          encoding: 'utf8',
          // No .env is applied and no DATABASE_URL is provided: the "no configuration" path.
          env: { ...process.env, QUEST_SKIP_DOTENV: 'true', DATABASE_URL: undefined },
        },
      );
      const output = `${result.stdout}${result.stderr}`;
      expect(output).not.toMatch(/is not a function|Cannot find module/);
      expect(result.status, output).toBe(2);
      expect(output).toContain('DATABASE_URL is required');
      expect(output).toContain('.env.example');
      // A failure message must never carry a value, only the variable name and the remedy.
      expect(output).not.toMatch(/postgres(ql)?:\/\//);
    }, 30_000);

    it('depends on nothing that has to be built first', () => {
      // A workspace or third-party import here would reintroduce the stale-`dist/` failure: these
      // modules run before anything else, on a fresh clone, with no `pnpm build` in between.
      for (const file of LOADER_FILES) {
        const source = readFileSync(path.join(CLI_DIR, file), 'utf8');
        const specifiers = [...source.matchAll(/^import\s.*from\s+'([^']+)'/gm)]
          .map((m) => m[1])
          .filter((s): s is string => s !== undefined);
        expect(specifiers.length).toBeGreaterThan(0);
        for (const specifier of specifiers) {
          expect(
            specifier.startsWith('node:') || specifier.startsWith('./'),
            `${file} imports "${specifier}" — the environment loader must depend only on Node built-ins and its own folder`,
          ).toBe(true);
        }
      }
    });

    it('is implemented in the CLI layer, never imported from a workspace package', () => {
      const source = readFileSync(path.join(CLI_DIR, LOADER), 'utf8');
      expect(source).toContain("from './dev-env'");
      expect(source).not.toMatch(/from '@quest\//);
    });
  });

  /**
   * The loader applies `.env.example` verbatim on a fresh machine, so the template must satisfy the
   * configuration schema: an empty placeholder means "not configured", never "invalid value".
   */
  it('the .env.example template parses as a valid configuration', () => {
    const root = path.resolve(__dirname, '..', '..', '..');
    const template = parseDotenv(readFileSync(path.join(root, '.env.example'), 'utf8'));
    expect(() => loadAppConfig(template)).not.toThrow();
  });
});
