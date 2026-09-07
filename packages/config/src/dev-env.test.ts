import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { findRepositoryRoot, loadDevEnv, parseDotenv } from './dev-env';

/** Builds a throwaway workspace: <root>/pnpm-workspace.yaml, <root>/.env, <root>/apps/api. */
function workspace(envFile: string): { root: string; appDir: string } {
  const root = mkdtempSync(path.join(tmpdir(), 'quest-env-'));
  writeFileSync(path.join(root, 'pnpm-workspace.yaml'), "packages:\n  - 'apps/*'\n");
  writeFileSync(path.join(root, '.env'), envFile);
  const appDir = path.join(root, 'apps', 'api');
  mkdirSync(appDir, { recursive: true });
  return { root, appDir };
}

const ENV_FILE = [
  '# local development defaults',
  'DATABASE_URL=postgresql://quest:quest@localhost:5432/quest',
  'export REDIS_URL=redis://localhost:6379',
  'AUTH_JWT_SECRET="a development secret that is long enough"',
  "S3_BUCKET='quest-media-local'   ",
  'CORS_ALLOWED_ORIGINS=http://localhost:3000,http://localhost:3001 # web + admin',
  'EMPTY_ON_PURPOSE=',
  'not a valid line',
].join('\n');

describe('dotenv parsing', () => {
  it('reads assignments, quotes, export prefixes and inline comments', () => {
    const parsed = parseDotenv(ENV_FILE);
    expect(parsed).toEqual({
      DATABASE_URL: 'postgresql://quest:quest@localhost:5432/quest',
      REDIS_URL: 'redis://localhost:6379',
      AUTH_JWT_SECRET: 'a development secret that is long enough',
      S3_BUCKET: 'quest-media-local',
      CORS_ALLOWED_ORIGINS: 'http://localhost:3000,http://localhost:3001',
      EMPTY_ON_PURPOSE: '',
    });
  });

  it('keeps a "#" that is part of a quoted value', () => {
    expect(parseDotenv('PASSWORD="p#ss word"')).toEqual({ PASSWORD: 'p#ss word' });
    expect(parseDotenv('URL=http://host/#anchor')).toEqual({ URL: 'http://host/#anchor' });
  });
});

describe('repository-root discovery', () => {
  it('walks up from a workspace subdirectory to the root that holds the marker', () => {
    const { root, appDir } = workspace(ENV_FILE);
    expect(findRepositoryRoot(appDir)).toBe(root);
    expect(findRepositoryRoot(root)).toBe(root);
  });
});

describe('loadDevEnv', () => {
  it('loads the root .env when a command runs from a workspace subdirectory', () => {
    // The regression this exists for: `pnpm db:migrate:status` from the repository root runs the
    // CLI with cwd = apps/api and used to fail with "DATABASE_URL is required".
    const { root, appDir } = workspace(ENV_FILE);
    const env: NodeJS.ProcessEnv = {};
    const result = loadDevEnv({ cwd: appDir, env });
    expect(result.file).toBe(path.join(root, '.env'));
    expect(result.skipped).toBeNull();
    expect(env.DATABASE_URL).toBe('postgresql://quest:quest@localhost:5432/quest');
    expect(env.REDIS_URL).toBe('redis://localhost:6379');
    expect(result.applied).toContain('DATABASE_URL');
  });

  it('never overrides a variable that is already set (CI and injected configuration win)', () => {
    const { appDir } = workspace(ENV_FILE);
    const env: NodeJS.ProcessEnv = {
      DATABASE_URL: 'postgresql://ci@ci-host:5432/ci',
      EMPTY_ON_PURPOSE: '',
    };
    const result = loadDevEnv({ cwd: appDir, env });
    expect(env.DATABASE_URL).toBe('postgresql://ci@ci-host:5432/ci');
    expect(result.ignored).toEqual(expect.arrayContaining(['DATABASE_URL', 'EMPTY_ON_PURPOSE']));
    expect(result.applied).not.toContain('DATABASE_URL');
    // Variables the environment does not define are still filled in.
    expect(env.REDIS_URL).toBe('redis://localhost:6379');
  });

  it('applies nothing in production or staging, and says so instead of failing silently', () => {
    for (const nodeEnv of ['production', 'staging']) {
      const { appDir } = workspace(ENV_FILE);
      const env: NodeJS.ProcessEnv = { NODE_ENV: nodeEnv };
      const warnings: string[] = [];
      const result = loadDevEnv({ cwd: appDir, env, warn: (m) => warnings.push(m) });
      expect(result.skipped).toBe('deployed-environment');
      expect(result.applied).toEqual([]);
      expect(env.DATABASE_URL).toBeUndefined();
      expect(warnings.join(' ')).toContain(nodeEnv);
    }
  });

  it('can be disabled, and points at another file on request', () => {
    const { root, appDir } = workspace(ENV_FILE);
    const disabled: NodeJS.ProcessEnv = { QUEST_SKIP_DOTENV: 'true' };
    expect(loadDevEnv({ cwd: appDir, env: disabled }).skipped).toBe('disabled');
    expect(disabled.DATABASE_URL).toBeUndefined();

    const other = path.join(root, '.env.second-db');
    writeFileSync(other, 'DATABASE_URL=postgresql://quest:quest@localhost:5432/other\n');
    const env: NodeJS.ProcessEnv = { QUEST_ENV_FILE: other };
    loadDevEnv({ cwd: appDir, env });
    expect(env.DATABASE_URL).toBe('postgresql://quest:quest@localhost:5432/other');
  });

  it('is a no-op when no file exists, and never throws', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'quest-env-none-'));
    writeFileSync(path.join(root, 'pnpm-workspace.yaml'), 'packages: []\n');
    const env: NodeJS.ProcessEnv = {};
    expect(loadDevEnv({ cwd: root, env })).toMatchObject({ skipped: 'not-found', applied: [] });
    expect(Object.keys(env)).toHaveLength(0);
  });
});
