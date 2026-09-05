import { describe, expect, it } from 'vitest';

import { isoDateTimeSchema, uuidSchema } from './common';
import {
  ApiErrorCode,
  apiErrorEnvelopeSchema,
  apiErrorHttpStatus,
  isApiErrorEnvelope,
} from './errors';
import {
  PAGINATION_DEFAULT_LIMIT,
  PAGINATION_MAX_LIMIT,
  cursorPaginationQuerySchema,
  sortQuerySchema,
} from './pagination';

describe('API error envelope', () => {
  it('accepts a well-formed envelope and rejects an unknown code', () => {
    const envelope = {
      error: {
        code: 'NOT_FOUND',
        message: 'Quest not found',
        correlationId: 'c-1',
        timestamp: '2026-09-04T00:00:00.000Z',
      },
    };
    expect(isApiErrorEnvelope(envelope)).toBe(true);
    expect(isApiErrorEnvelope({ error: { ...envelope.error, code: 'WHATEVER' } })).toBe(false);
    expect(isApiErrorEnvelope({ message: 'legacy shape' })).toBe(false);
  });

  it('carries validation issues only as structured entries', () => {
    const r = apiErrorEnvelopeSchema.safeParse({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid request',
        issues: [{ path: 'title', message: 'Required' }],
        correlationId: 'c-2',
        timestamp: '2026-09-04T00:00:00.000Z',
      },
    });
    expect(r.success).toBe(true);
  });

  it('maps every error code to an HTTP status', () => {
    for (const code of Object.values(ApiErrorCode)) {
      expect(apiErrorHttpStatus[code]).toBeGreaterThanOrEqual(400);
    }
    expect(apiErrorHttpStatus.RATE_LIMITED).toBe(429);
    expect(apiErrorHttpStatus.SERVICE_UNAVAILABLE).toBe(503);
  });
});

describe('pagination', () => {
  it('applies defaults and enforces the maximum limit', () => {
    expect(cursorPaginationQuerySchema.parse({}).limit).toBe(PAGINATION_DEFAULT_LIMIT);
    expect(cursorPaginationQuerySchema.parse({ limit: '50' }).limit).toBe(50);
    expect(cursorPaginationQuerySchema.safeParse({ limit: PAGINATION_MAX_LIMIT + 1 }).success).toBe(
      false,
    );
    expect(cursorPaginationQuerySchema.safeParse({ limit: 0 }).success).toBe(false);
  });

  it('parses whitelisted sort tokens and rejects unknown fields', () => {
    const schema = sortQuerySchema(['createdAt', 'title']);
    expect(schema.parse('createdAt:desc,title')).toEqual([
      { field: 'createdAt', direction: 'desc' },
      { field: 'title', direction: 'asc' },
    ]);
    expect(schema.safeParse('password:asc').success).toBe(false);
    expect(schema.safeParse('createdAt:sideways').success).toBe(false);
  });
});

describe('common primitives', () => {
  it('requires UTC ISO timestamps and UUIDs', () => {
    expect(isoDateTimeSchema.safeParse('2026-09-04T18:20:11.123Z').success).toBe(true);
    expect(isoDateTimeSchema.safeParse('2026-09-04 18:20').success).toBe(false);
    expect(uuidSchema.safeParse('018f3f2e-9c1e-7c8a-b4a5-0f1e2d3c4b5a').success).toBe(true);
    expect(uuidSchema.safeParse('not-a-uuid').success).toBe(false);
  });
});
