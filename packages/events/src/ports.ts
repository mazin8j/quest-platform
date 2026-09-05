import type { DomainEventEnvelope } from './envelope';

/**
 * Outbound port. Domain modules depend on this interface only.
 * Implementations: InMemoryEventBus (local/test), EventBridgePublisher (AWS, Phase 01+ when a
 * consumer exists). Publishing must be called AFTER the owning transaction commits (or via an
 * outbox) — never inside it.
 */
export interface EventPublisher {
  publish(event: DomainEventEnvelope): Promise<void>;
  publishAll(events: ReadonlyArray<DomainEventEnvelope>): Promise<void>;
}

export type EventHandler<P extends Record<string, unknown> = Record<string, unknown>> = (
  event: DomainEventEnvelope<P>,
) => Promise<void>;

/**
 * Inbound port. Handlers MUST be idempotent (CLAUDE.md rule 12): the same eventId may be
 * delivered more than once. Use eventId as the deduplication key.
 */
export interface EventSubscriber {
  subscribe<P extends Record<string, unknown>>(
    eventType: string,
    handler: EventHandler<P>,
  ): () => void;
}

/** Result of a handler execution, for observability. */
export interface EventDeliveryResult {
  eventId: string;
  eventType: string;
  handlerCount: number;
  failures: ReadonlyArray<{ handlerIndex: number; error: string }>;
}
