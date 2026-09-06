import path from 'node:path';

import { defineConfig } from 'vitest/config';

// Pure-TypeScript modules only (env, storage abstraction, permissions, auth store, routing).
// React Native component rendering tests require jest-expo / RNTL and are tracked as TD-06.
export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
