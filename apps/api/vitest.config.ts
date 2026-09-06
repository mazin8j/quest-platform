import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// SWC is required so NestJS decorator metadata (emitDecoratorMetadata) is emitted under Vitest.
const swcPlugin = swc.vite({ module: { type: 'es6' }, jsc: { target: 'es2022' } });

export default defineConfig({
  plugins: [swcPlugin],
  test: {
    environment: 'node',
    projects: [
      {
        plugins: [swcPlugin],
        test: {
          name: 'unit',
          environment: 'node',
          include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
          exclude: ['test/integration/**', 'test/e2e/**'],
          setupFiles: ['test/setup.ts'],
        },
      },
      {
        plugins: [swcPlugin],
        test: {
          name: 'integration',
          environment: 'node',
          include: ['test/integration/**/*.int.test.ts', 'test/e2e/**/*.e2e.test.ts'],
          setupFiles: ['test/setup.ts'],
          testTimeout: 60_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
