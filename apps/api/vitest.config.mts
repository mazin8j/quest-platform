import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// SWC is required so NestJS decorator metadata (emitDecoratorMetadata) is emitted under Vitest.
// This file is `.mts` so Vite loads it as ESM (a `.ts` config is read as CommonJS and warns).
// The plugin is declared once here: inline projects inherit the declaring config's plugins.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' }, jsc: { target: 'es2022' } })],
  test: {
    environment: 'node',
    projects: [
      {
        test: {
          name: 'unit',
          environment: 'node',
          include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
          exclude: ['test/integration/**', 'test/e2e/**'],
          setupFiles: ['test/setup.ts'],
        },
      },
      {
        test: {
          name: 'integration',
          environment: 'node',
          include: ['test/integration/**/*.int.test.ts', 'test/e2e/**/*.e2e.test.ts'],
          // Its own setup: real infrastructure, pinned application configuration.
          setupFiles: ['test/setup.integration.ts'],
          testTimeout: 60_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
