import { defineConfig } from 'vitest/config';

// Pure-TypeScript modules only (env, storage abstraction, permissions model). Component tests
// require the React Native test renderer and arrive with the first real screens (Phase 01).
export default defineConfig({
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
