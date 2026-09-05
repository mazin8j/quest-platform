import { describe, expect, it } from 'vitest';

import {
  createRequestContext,
  getCorrelationId,
  getRequestContext,
  runWithRequestContext,
  sanitizeIncomingId,
} from './request-context';

describe('request context', () => {
  it('accepts a well-formed client correlation id and rejects unsafe ones', () => {
    expect(sanitizeIncomingId('journey-2026-09-04:abc')).toBe('journey-2026-09-04:abc');
    expect(sanitizeIncomingId('short')).toBeUndefined();
    expect(sanitizeIncomingId('<script>alert(1)</script>')).toBeUndefined();
    expect(sanitizeIncomingId('x'.repeat(200))).toBeUndefined();
    expect(sanitizeIncomingId(['a', 'b'])).toBeUndefined();
  });

  it('falls back to the generated request id when no correlation id is supplied', () => {
    const ctx = createRequestContext(undefined);
    expect(ctx.correlationId).toBe(ctx.requestId);
    expect(ctx.requestId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('is available inside the async scope and absent outside it', async () => {
    expect(getRequestContext()).toBeUndefined();
    expect(getCorrelationId()).toBe('no-request-context');
    const ctx = createRequestContext('corr-1234567890');
    await runWithRequestContext(ctx, async () => {
      await Promise.resolve();
      expect(getRequestContext()?.correlationId).toBe('corr-1234567890');
      expect(getCorrelationId()).toBe('corr-1234567890');
    });
    expect(getRequestContext()).toBeUndefined();
  });
});
