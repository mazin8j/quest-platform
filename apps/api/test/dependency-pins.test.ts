import { describe, expect, it } from 'vitest';

/**
 * Guards on transitive dependencies we have deliberately overridden.
 *
 * `pnpm audit --audit-level=high` is the CI gate, but it fails *after* a regression is already in
 * the lockfile and only while the advisory database still carries the entry. These assertions fail
 * in the ordinary unit run, name the reason, and survive the advisory being reclassified.
 */
describe('dependency pins', () => {
  /**
   * `@nestjs/platform-express@12.0.1` — the latest release — pins multer to exactly `2.2.0`, which
   * carries GHSA-wc9g-mqfw-jrwm, GHSA-qfvm-cv95-jqjf and GHSA-535w-7cp7-47q4 (high) and
   * GHSA-qvfw-j98x-7q72 (low), all fixed in 2.3.0. No upstream release depends on the fixed
   * version, so `pnpm-workspace.yaml` overrides the pin (BACKLOG TD-60).
   *
   * QUEST mounts no multer middleware, so this is defence in depth rather than a live fix — which
   * is exactly why it needs a test: nothing in the product's own behaviour would notice if the
   * override were dropped in a future lockfile update.
   */
  it('resolves multer at or above the patched 2.3.0', async () => {
    const { version } = (await import('multer/package.json')) as unknown as { version: string };
    const parts = version.split('.').map((part) => Number.parseInt(part, 10));
    const major = parts[0];
    const minor = parts[1];
    expect(
      major !== undefined &&
        minor !== undefined &&
        Number.isFinite(major) &&
        Number.isFinite(minor),
      `unparseable multer version ${version}`,
    ).toBe(true);
    expect(
      major !== undefined && minor !== undefined && (major > 2 || (major === 2 && minor >= 3)),
      `multer ${version} is below the patched 2.3.0 — the pnpm-workspace.yaml override was lost ` +
        '(TD-60). Restore it, or remove this test if @nestjs/platform-express now depends on a ' +
        'fixed version itself.',
    ).toBe(true);
  });
});
