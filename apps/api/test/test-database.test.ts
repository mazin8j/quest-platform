import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { provisionSuiteDatabase, suiteDatabaseName } from './integration/helpers/test-database';

/**
 * Unit-level guard for the integration isolation rules (no database needed).
 *
 * Integration suites used to share one database and reset its schema, which raced under Vitest's
 * default file parallelism. Names must therefore be deterministic (a suite always gets the same
 * database, so a run is reproducible and an abandoned database is reused, not multiplied) and
 * confined to the `quest_it_` namespace (nothing can ever drop a real database).
 */
describe('integration suite databases', () => {
  it('derives one deterministic database name per test file', () => {
    expect(suiteDatabaseName('/repo/apps/api/test/integration/identity.int.test.ts')).toBe(
      'quest_it_identity',
    );
    expect(suiteDatabaseName('/repo/apps/api/test/e2e/onboarding-journey.e2e.test.ts')).toBe(
      'quest_it_onboarding_journey',
    );
    expect(suiteDatabaseName('/repo/apps/api/test/integration/database.int.test.ts')).toBe(
      'quest_it_database',
    );
    // Same input, same output — twice, and independent of the directory it came from.
    expect(suiteDatabaseName(path.join('a', 'b', 'identity.int.test.ts'))).toBe(
      suiteDatabaseName('identity.int.test.ts'),
    );
  });

  it('produces distinct names for distinct suites', () => {
    const names = [
      'identity.int.test.ts',
      'database.int.test.ts',
      'onboarding-journey.e2e.test.ts',
    ].map(suiteDatabaseName);
    expect(new Set(names).size).toBe(names.length);
  });

  it('emits identifiers PostgreSQL accepts', () => {
    const long = suiteDatabaseName(`${'x'.repeat(200)}.int.test.ts`);
    expect(long.length).toBeLessThanOrEqual(63);
    expect(long).toMatch(/^quest_it_[a-z0-9_]+$/);
  });

  it('refuses to touch anything outside the test namespace', async () => {
    // The provisioning helper drops before it creates: the namespace check is the safety rail.
    await expect(
      provisionSuiteDatabase('postgresql://user@host:5432/quest', 'quest'),
    ).rejects.toThrow(/outside the test namespace/);
    await expect(
      provisionSuiteDatabase('postgresql://user@host:5432/quest', 'postgres'),
    ).rejects.toThrow(/outside the test namespace/);
  });
});
