import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Regression guard for the "DATABASE_URL is required" trap: every executable entry point must
 * apply the repository-root `.env` before it reads `process.env`, so repository-root commands
 * (`pnpm db:migrate`, `pnpm db:migrate:status`, `pnpm db:reset:dev`, the identity CLIs) work
 * without exported variables. A new CLI that forgets the import fails this test.
 */
const CLI_DIR = path.resolve(__dirname, '..', 'src', 'cli');
const LOADER = 'load-env.ts';

describe('CLI environment loading', () => {
  const entryPoints = readdirSync(CLI_DIR).filter((f) => f.endsWith('.ts') && f !== LOADER);

  it('finds the CLI entry points', () => {
    expect(entryPoints).toEqual(expect.arrayContaining(['migrate.ts', 'reset-dev-db.ts']));
  });

  it.each(entryPoints)('%s imports the environment loader before anything else', (file) => {
    const source = readFileSync(path.join(CLI_DIR, file), 'utf8');
    expect(source, `${file} must import './load-env'`).toContain("import './load-env'");
    const imports = [...source.matchAll(/^import\s.*$/gm)].map((m) => m[0]);
    const loaderIndex = imports.findIndex((line) => line.includes('./load-env'));
    // Only `reflect-metadata` (which must initialise the decorator metadata polyfill first) may
    // precede it; everything else could read configuration at import time.
    expect(imports.slice(0, loaderIndex).every((line) => line.includes('reflect-metadata'))).toBe(
      true,
    );
  });

  it('is applied by the API entry point as well', () => {
    const main = readFileSync(path.resolve(__dirname, '..', 'src', 'main.ts'), 'utf8');
    expect(main).toContain("import './cli/load-env'");
  });
});
