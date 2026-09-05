import { describe, expect, it } from 'vitest';

import { InMemoryAnalyticsSink, analyticsEventSchema } from './index';

const base = {
  name: 'mobile_quest_accepted',
  occurredAt: '2026-09-04T00:00:00.000Z',
  anonymousId: 'anon-1',
  consent: { analytics: true, personalization: false },
  properties: { questCategory: 'fitness', difficulty: 'EASY' },
};

describe('analytics contract', () => {
  it('enforces surface-prefixed snake_case names and primitive-only properties', () => {
    expect(analyticsEventSchema.safeParse(base).success).toBe(true);
    expect(analyticsEventSchema.safeParse({ ...base, name: 'QuestAccepted' }).success).toBe(false);
    expect(analyticsEventSchema.safeParse({ ...base, name: 'quest_accepted' }).success).toBe(false);
    expect(
      analyticsEventSchema.safeParse({ ...base, properties: { user: { email: 'x@y.z' } } }).success,
    ).toBe(false);
  });

  it('never accepts precise location in context', () => {
    expect(
      analyticsEventSchema.safeParse({ ...base, context: { countryCode: 'JO' } }).success,
    ).toBe(true);
    expect(
      analyticsEventSchema.safeParse({ ...base, context: { countryCode: '31.9,35.9' } }).success,
    ).toBe(false);
  });

  it('sink drops events without analytics consent', async () => {
    const sink = new InMemoryAnalyticsSink();
    await sink.track(base);
    await sink.track({ ...base, consent: { analytics: false, personalization: false } });
    expect(sink.events).toHaveLength(1);
    expect(sink.dropped).toHaveLength(1);
  });
});
