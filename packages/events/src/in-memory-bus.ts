import type { DomainEventEnvelope } from './envelope';
import type { EventDeliveryResult, EventHandler, EventPublisher, EventSubscriber } from './ports';

export interface InMemoryEventBusOptions {
  /** Called for every delivery; use for logging/metrics. */
  onDelivered?: (result: EventDeliveryResult) => void;
  /** When true (default), a handler failure does not prevent other handlers from running. */
  isolateHandlerFailures?: boolean;
  /** Upper bound for the retained log / seen-id set (oldest entries are dropped). Default 1000. */
  maxRetained?: number;
}

/**
 * Development/test event bus. Delivers synchronously-awaited, in-process, at-least-once semantics
 * (a failing handler is reported, not retried — retries are a queue concern in AWS).
 * NOT for production: no durability, no cross-process delivery.
 */
export class InMemoryEventBus implements EventPublisher, EventSubscriber {
  private readonly handlers = new Map<string, Set<EventHandler>>();
  private readonly seen = new Set<string>();
  private readonly log: DomainEventEnvelope[] = [];

  constructor(private readonly options: InMemoryEventBusOptions = {}) {}

  subscribe<P extends Record<string, unknown>>(
    eventType: string,
    handler: EventHandler<P>,
  ): () => void {
    const set = this.handlers.get(eventType) ?? new Set<EventHandler>();
    set.add(handler as EventHandler);
    this.handlers.set(eventType, set);
    return () => {
      set.delete(handler as EventHandler);
    };
  }

  async publish(event: DomainEventEnvelope): Promise<void> {
    this.log.push(event);
    // Simulate broker-level de-duplication is NOT done here on purpose: handlers must be idempotent.
    this.seen.add(event.eventId);
    // Bounded retention: the log exists for tests and diagnostics, never as durable storage.
    const max = this.options.maxRetained ?? 1000;
    while (this.log.length > max) this.log.shift();
    if (this.seen.size > max) {
      for (const id of this.seen) {
        if (this.seen.size <= max) break;
        this.seen.delete(id);
      }
    }
    const handlers = [...(this.handlers.get(event.eventType) ?? [])];
    const failures: { handlerIndex: number; error: string }[] = [];
    for (const [index, handler] of handlers.entries()) {
      try {
        await handler(event);
      } catch (error) {
        failures.push({
          handlerIndex: index,
          error: error instanceof Error ? error.message : String(error),
        });
        if (this.options.isolateHandlerFailures === false) break;
      }
    }
    this.options.onDelivered?.({
      eventId: event.eventId,
      eventType: event.eventType,
      handlerCount: handlers.length,
      failures,
    });
    if (failures.length > 0 && this.options.isolateHandlerFailures === false) {
      throw new Error(`Event ${event.eventType} handler failed: ${failures[0]?.error}`);
    }
  }

  async publishAll(events: ReadonlyArray<DomainEventEnvelope>): Promise<void> {
    for (const e of events) await this.publish(e);
  }

  /** Test helper: every event published so far, in order. */
  published(): ReadonlyArray<DomainEventEnvelope> {
    return this.log;
  }

  /** Test helper: has this eventId been delivered at least once? */
  hasDelivered(eventId: string): boolean {
    return this.seen.has(eventId);
  }

  clear(): void {
    this.log.length = 0;
    this.seen.clear();
  }
}
