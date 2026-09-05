import { defineConfig } from 'vitest/config';

// Pure-TypeScript modules only (env, api wiring). Component tests arrive with the first real UI.
export default defineConfig({
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
