import path from 'node:path';

import { defineConfig } from 'vitest/config';

// ESM config (`.mts`): `import.meta.dirname` replaces `__dirname`, which Vite's native config
// loader cannot provide.

// Pure-TypeScript modules only (env, storage abstraction, permissions, auth store, routing).
// React Native component rendering tests require jest-expo / RNTL and are tracked as TD-06.
export default defineConfig({
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
