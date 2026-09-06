import { describe, expect, it } from 'vitest';

import { createEvent } from '../envelope';
import { AccountDeleted, AccountRegistered, IDENTITY_EVENTS } from './identity';

describe('identity event catalogue', () => {
  it('declares unique, well-formed event types', () => {
    const types = IDENTITY_EVENTS.map((e) => e.eventType);
    expect(new Set(types).size).toBe(types.length);
    for (const t of types) expect(t).toMatch(/^(identity|profiles)\.[a-z-]+\.[a-z-]+$/);
  });

  it('carries identifiers only — never email, DOB or tokens', () => {
    const event = createEvent(
      AccountRegistered,
      {
        accountId: '019203f4-1c3a-7d8e-8b3b-0f4c2a1e5d66',
        method: 'PASSWORD',
        ageBand: 'ADULT',
        country: 'JO',
        language: 'ar',
      },
      {
        aggregateId: '019203f4-1c3a-7d8e-8b3b-0f4c2a1e5d66',
        correlationId: 'c-1',
        source: 'api.identity',
      },
    );
    expect(Object.keys(event.payload)).not.toEqual(
      expect.arrayContaining(['email', 'dateOfBirth', 'password', 'token']),
    );
    expect(event.dataClassification).toBe('INTERNAL');
    expect(() =>
      createEvent(
        AccountRegistered,
        {
          accountId: 'not-a-uuid',
          method: 'PASSWORD',
          ageBand: 'ADULT',
          country: null,
          language: null,
        },
        { aggregateId: 'x', correlationId: 'c', source: 'api.identity' },
      ),
    ).toThrow();
  });

  it('models deletion as a terminal fact with the request id for idempotent handlers', () => {
    expect(
      AccountDeleted.payloadSchema.safeParse({
        accountId: '019203f4-1c3a-7d8e-8b3b-0f4c2a1e5d66',
        deletionRequestId: '019203f4-1c3a-7d8e-8b3b-0f4c2a1e5d67',
        deletedAt: '2026-09-06T10:00:00.000Z',
      }).success,
    ).toBe(true);
  });
});
