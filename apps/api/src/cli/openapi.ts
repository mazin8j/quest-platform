/**
 * Writes the generated OpenAPI document to docs/api/openapi/v1.json (ADR-012).
 *   pnpm --filter @quest/api openapi:generate
 * CI/unit test `src/openapi/openapi.test.ts` fails when the committed file is stale.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { buildOpenApiDocument } from '../openapi/build-openapi';

export const OPENAPI_OUTPUT = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  'docs',
  'api',
  'openapi',
  'v1.json',
);

export function renderOpenApi(): string {
  return `${JSON.stringify(buildOpenApiDocument(), null, 2)}\n`;
}

if (require.main === module) {
  mkdirSync(path.dirname(OPENAPI_OUTPUT), { recursive: true });
  writeFileSync(OPENAPI_OUTPUT, renderOpenApi());
  console.warn(`OpenAPI written to ${OPENAPI_OUTPUT}`);
}
