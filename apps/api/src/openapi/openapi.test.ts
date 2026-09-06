import { existsSync, readFileSync } from 'node:fs';

import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { OPENAPI_OUTPUT, renderOpenApi } from '../cli/openapi';
import { createTestApp } from '../../test/helpers/create-test-app';
import { buildOpenApiDocument } from './build-openapi';
import { ROUTES } from './routes';

interface ExpressLayer {
  route?: { path: string; methods: Record<string, boolean> };
}

describe('OpenAPI route registry (ADR-012)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(async () => {
    await app.close();
  });

  it('documents every HTTP route the application registers, and nothing else', () => {
    const router = app.getHttpAdapter().getInstance() as {
      _router?: { stack: ExpressLayer[] };
      router?: { stack: ExpressLayer[] };
    };
    const stack = router._router?.stack ?? router.router?.stack ?? [];
    const registered = new Set<string>();
    for (const layer of stack) {
      // Skip Nest's catch-all 404 handler (`{/*splat}` for every verb).
      if (!layer.route || layer.route.path.includes('*')) continue;
      for (const [method, on] of Object.entries(layer.route.methods)) {
        if (on && ['get', 'post', 'put', 'patch', 'delete'].includes(method)) {
          registered.add(`${method.toUpperCase()} ${layer.route.path}`);
        }
      }
    }
    const documented = new Set(ROUTES.map((r) => `${r.method} ${r.path}`));
    const undocumented = [...registered].filter((r) => !documented.has(r)).sort();
    const phantom = [...documented].filter((r) => !registered.has(r)).sort();
    expect(undocumented, 'routes missing from src/openapi/routes.ts').toEqual([]);
    expect(phantom, 'documented routes that do not exist').toEqual([]);
    expect(registered.size).toBeGreaterThan(40);
  });

  it('builds a valid, deterministic OpenAPI 3.1 document with security on every non-public route', () => {
    const doc = buildOpenApiDocument() as {
      openapi: string;
      paths: Record<
        string,
        Record<string, { security: unknown[]; responses: Record<string, unknown> }>
      >;
    };
    expect(doc.openapi).toBe('3.1.0');
    expect(renderOpenApi()).toBe(renderOpenApi());
    for (const [p, ops] of Object.entries(doc.paths)) {
      for (const [method, op] of Object.entries(ops)) {
        const descriptor = ROUTES.find(
          (r) =>
            r.method === method.toUpperCase() && r.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}') === p,
        );
        expect(descriptor, `${method} ${p}`).toBeDefined();
        if (descriptor?.auth !== 'public') {
          expect(op.security).toEqual([{ bearerAuth: [] }]);
          expect(op.responses['401']).toBeDefined();
        }
        expect(op.responses['429']).toBeDefined();
      }
    }
  });

  it('matches the committed docs/api/openapi/v1.json (run `pnpm --filter @quest/api openapi:generate`)', () => {
    expect(existsSync(OPENAPI_OUTPUT)).toBe(true);
    expect(readFileSync(OPENAPI_OUTPUT, 'utf8')).toBe(renderOpenApi());
  });
});
