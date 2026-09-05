import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { createEvent, defineEvent, domainEventEnvelopeSchema, parseEvent } from './envelope';
import { InMemoryEventBus } from './in-memory-bus';

const SystemStarted = defineEvent({
  eventType: 'platform.service.started',
  eventVersion: 1,
  aggregateType: 'Service',
  payloadSchema: z.object({ service: z.string(), version: z.string() }),
  dataClassification: 'PUBLIC',
});

describe('event envelope', () => {
  it('creates a fully populated, schema-valid envelope', () => {
    const e = createEvent(
      SystemStarted,
      { service: 'quest-api', version: '0.0.0' },
      {
        aggregateId: 'quest-api',
        correlationId: 'corr-1',
        source: 'api.system',
        actorId: 'system',
      },
    );
    expect(domainEventEnvelopeSchema.safeParse(e).success).toBe(true);
    expect(e.eventType).toBe('platform.service.started');
    expect(e.eventVersion).toBe(1);
    expect(e.eventId).toMatch(/^[0-9a-f-]{36}$/);
    expect(e.occurredAt).toMatch(/Z$/);
    expect(e.dataClassification).toBe('PUBLIC');
    expect(e.payload).toEqual({ service: 'quest-api', version: '0.0.0' });
  });

  it('rejects payloads that violate the event definition', () => {
    expect(() =>
      createEvent(
        SystemStarted,
        // @ts-expect-error — intentionally wrong payload
        { service: 42 },
        { aggregateId: 'x', correlationId: 'c', source: 's' },
      ),
    ).toThrow();
  });

  it('enforces the <context>.<aggregate>.<action> naming convention', () => {
    expect(() =>
      defineEvent({
        eventType: 'QuestCreated',
        eventVersion: 1,
        aggregateType: 'Quest',
        payloadSchema: z.object({}),
      }),
    ).toThrow();
    expect(() =>
      defineEvent({
        eventType: 'quest.created',
        eventVersion: 1,
        aggregateType: 'Quest',
        payloadSchema: z.object({}),
      }),
    ).toThrow();
  });

  it('parses inbound messages, tolerates older versions and rejects newer or foreign ones', () => {
    const raw = JSON.parse(
      JSON.stringify(
        createEvent(
          SystemStarted,
          { service: 'a', version: '1' },
          { aggregateId: 'a', correlationId: 'c', source: 's' },
        ),
      ),
    ) as Record<string, unknown>;
    expect(parseEvent(SystemStarted, raw).payload.service).toBe('a');
    expect(() =>
      parseEvent(SystemStarted, { ...raw, eventType: 'platform.service.stopped' }),
    ).toThrow(/Expected event type/);
    expect(() => parseEvent(SystemStarted, { ...raw, eventVersion: 2 })).toThrow(/newer/);
    expect(() => parseEvent(SystemStarted, { ...raw, eventId: 'not-a-uuid' })).toThrow();
  });
});

describe('InMemoryEventBus', () => {
  const make = () =>
    createEvent(
      SystemStarted,
      { service: 'a', version: '1' },
      { aggregateId: 'a', correlationId: 'c', source: 's' },
    );

  it('delivers to all subscribers of the type and to nobody else', async () => {
    const bus = new InMemoryEventBus();
    const a = vi.fn().mockResolvedValue(undefined);
    const b = vi.fn().mockResolvedValue(undefined);
    const other = vi.fn().mockResolvedValue(undefined);
    bus.subscribe('platform.service.started', a);
    bus.subscribe('platform.service.started', b);
    bus.subscribe('platform.service.stopped', other);
    const e = make();
    await bus.publish(e);
    expect(a).toHaveBeenCalledWith(e);
    expect(b).toHaveBeenCalledWith(e);
    expect(other).not.toHaveBeenCalled();
    expect(bus.published()).toHaveLength(1);
    expect(bus.hasDelivered(e.eventId)).toBe(true);
  });

  it('isolates handler failures by default and reports them for observability', async () => {
    const delivered = vi.fn();
    const bus = new InMemoryEventBus({ onDelivered: delivered });
    const bad = vi.fn().mockRejectedValue(new Error('boom'));
    const good = vi.fn().mockResolvedValue(undefined);
    bus.subscribe('platform.service.started', bad);
    bus.subscribe('platform.service.started', good);
    await expect(bus.publish(make())).resolves.toBeUndefined();
    expect(good).toHaveBeenCalledTimes(1);
    expect(delivered).toHaveBeenCalledWith(
      expect.objectContaining({ handlerCount: 2, failures: [{ handlerIndex: 0, error: 'boom' }] }),
    );
  });

  it('supports unsubscribe and redelivery of the same eventId (handlers must be idempotent)', async () => {
    const bus = new InMemoryEventBus();
    const seen = new Set<string>();
    const idempotentHandler = vi.fn((ev: { eventId: string }) => {
      seen.add(ev.eventId);
      return Promise.resolve();
    });
    const off = bus.subscribe('platform.service.started', idempotentHandler);
    const e = make();
    await bus.publish(e);
    await bus.publish(e);
    expect(idempotentHandler).toHaveBeenCalledTimes(2);
    expect(seen.size).toBe(1);
    off();
    await bus.publish(e);
    expect(idempotentHandler).toHaveBeenCalledTimes(2);
  });
});
