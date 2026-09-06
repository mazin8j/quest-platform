import { apiErrorEnvelopeSchema } from '@quest/types';
import { z } from 'zod';

import { SERVICE_VERSION } from '../version';
import { ROUTES, type RouteDescriptor } from './routes';

/**
 * Builds an OpenAPI 3.1 document from the route registry and the zod contracts in @quest/types
 * (ADR-012: zod is the source of truth; JSON Schema is derived with `z.toJSONSchema`).
 * Output is deterministic so the committed file can be diffed and drift-checked in CI.
 */
export function buildOpenApiDocument(
  routes: ReadonlyArray<RouteDescriptor> = ROUTES,
): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const route of [...routes].sort(
    (a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method),
  )) {
    const oasPath = route.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
    const params = [...route.path.matchAll(/:([A-Za-z0-9_]+)/g)].map((m) => ({
      name: m[1],
      in: 'path',
      required: true,
      schema: { type: 'string' },
    }));
    const queryParams = route.query ? queryParameters(route.query) : [];
    const responses: Record<string, unknown> = {};
    for (const [status, schema] of Object.entries(route.responses)) {
      const code = Number(status);
      if (schema) {
        responses[status] = {
          description: describeStatus(code),
          content: { 'application/json': { schema: toJsonSchema(schema) } },
        };
      } else if (code >= 400) {
        responses[status] = {
          description: describeStatus(code),
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/ApiErrorEnvelope' } },
          },
        };
      } else {
        responses[status] = { description: describeStatus(code) };
      }
    }
    if (route.auth !== 'public') {
      responses['401'] ??= {
        description: 'Missing or invalid bearer token',
        content: {
          'application/json': { schema: { $ref: '#/components/schemas/ApiErrorEnvelope' } },
        },
      };
      responses['403'] ??= {
        description: 'Insufficient permission, disallowed account state, or unverified email',
        content: {
          'application/json': { schema: { $ref: '#/components/schemas/ApiErrorEnvelope' } },
        },
      };
    }
    responses['429'] ??= {
      description: 'Rate limited (retry-after header)',
      content: {
        'application/json': { schema: { $ref: '#/components/schemas/ApiErrorEnvelope' } },
      },
    };

    const operation: Record<string, unknown> = {
      tags: [route.tag],
      summary: route.summary,
      operationId: operationId(route),
      parameters: [...params, ...queryParams],
      responses,
      security: route.auth === 'public' ? [] : [{ bearerAuth: [] }],
      'x-quest-permissions': route.auth === 'public' ? [] : route.auth,
      'x-quest-account-states':
        route.states ?? (route.auth === 'public' ? [] : ['ACTIVE', 'PENDING_VERIFICATION']),
      ...(route.requiresVerifiedEmail ? { 'x-quest-requires-verified-email': true } : {}),
      ...(route.rateLimit ? { 'x-quest-rate-limit': route.rateLimit } : {}),
    };
    if (route.request) {
      operation.requestBody = {
        required: true,
        content: { 'application/json': { schema: toJsonSchema(route.request) } },
      };
    }
    paths[oasPath] ??= {};
    paths[oasPath][route.method.toLowerCase()] = operation;
  }

  return {
    openapi: '3.1.0',
    info: {
      title: 'QUEST API',
      version: SERVICE_VERSION,
      description:
        'Generated from the zod contracts in @quest/types (ADR-012). Conventions: docs/api/API_CONVENTIONS.md. Regenerate with `pnpm --filter @quest/api openapi:generate`.',
    },
    servers: [{ url: 'http://localhost:4000', description: 'local' }],
    tags: [...new Set(routes.map((r) => r.tag))].sort().map((name) => ({ name })),
    paths,
    components: {
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
      schemas: { ApiErrorEnvelope: toJsonSchema(apiErrorEnvelopeSchema) },
    },
  };
}

function toJsonSchema(schema: z.ZodTypeAny): unknown {
  const json = z.toJSONSchema(schema, {
    target: 'draft-2020-12',
    io: 'input',
    unrepresentable: 'any',
  }) as Record<string, unknown>;
  delete json.$schema;
  return json;
}

function queryParameters(schema: z.ZodTypeAny): unknown[] {
  const json = toJsonSchema(schema) as {
    properties?: Record<string, unknown>;
    required?: string[];
  };
  return Object.entries(json.properties ?? {}).map(([name, s]) => ({
    name,
    in: 'query',
    required: json.required?.includes(name) ?? false,
    schema: s,
  }));
}

function operationId(route: RouteDescriptor): string {
  const parts = route.path
    .replace(/^\/v1\//, '')
    .replace(/^\//, '')
    .split('/')
    .filter(Boolean)
    .map((p) => (p.startsWith(':') ? `by-${p.slice(1)}` : p));
  return `${route.method.toLowerCase()}-${parts.join('-')}`.replace(/[^a-z0-9-]/gi, '-');
}

function describeStatus(code: number): string {
  const map: Record<number, string> = {
    200: 'OK',
    201: 'Created',
    202: 'Accepted',
    204: 'No content',
    400: 'Validation error',
    401: 'Unauthenticated',
    403: 'Forbidden',
    404: 'Not found',
    409: 'Conflict',
    429: 'Rate limited',
    503: 'Service unavailable',
  };
  return map[code] ?? `HTTP ${code}`;
}
