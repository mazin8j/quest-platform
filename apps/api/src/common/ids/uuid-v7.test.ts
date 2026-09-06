import { describe, expect, it } from 'vitest';

import { uuidv7, uuidv7Timestamp } from './uuid-v7';

describe('uuidv7', () => {
  it('produces RFC 9562 v7 identifiers that sort by time and round-trip their timestamp', () => {
    const t = Date.UTC(2026, 8, 6, 12, 0, 0);
    const a = uuidv7(t);
    const b = uuidv7(t + 1);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(uuidv7Timestamp(a)).toBe(t);
    expect(a < b).toBe(true);
    expect(uuidv7Timestamp('123e4567-e89b-42d3-a456-426614174000')).toBeUndefined();
    const many = new Set(Array.from({ length: 1000 }, () => uuidv7(t)));
    expect(many.size).toBe(1000);
  });
});
