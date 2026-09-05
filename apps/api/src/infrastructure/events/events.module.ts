import { Global, Module } from '@nestjs/common';
import { InMemoryEventBus, type EventPublisher, type EventSubscriber } from '@quest/events';
import { Logger } from 'nestjs-pino';

/** DI tokens for the outbound/inbound event ports (ADR-003). */
export const EVENT_PUBLISHER = Symbol('EVENT_PUBLISHER');
export const EVENT_SUBSCRIBER = Symbol('EVENT_SUBSCRIBER');

/**
 * Phase 00 wires the in-process bus for every environment. The EventBridge/SQS publisher adapter
 * is added when the first cross-process consumer exists (Phase 05 media workers at the latest);
 * domain code will not change because it depends on EventPublisher/EventSubscriber only.
 */
@Global()
@Module({
  providers: [
    {
      provide: InMemoryEventBus,
      useFactory: (logger: Logger) =>
        new InMemoryEventBus({
          onDelivered: (r) => {
            if (r.failures.length > 0) {
              logger.warn(
                { eventId: r.eventId, eventType: r.eventType, failures: r.failures },
                'event handler failure',
              );
            }
          },
        }),
      inject: [Logger],
    },
    { provide: EVENT_PUBLISHER, useExisting: InMemoryEventBus },
    { provide: EVENT_SUBSCRIBER, useExisting: InMemoryEventBus },
  ],
  exports: [EVENT_PUBLISHER, EVENT_SUBSCRIBER],
})
export class EventsModule {}

export type { EventPublisher, EventSubscriber };
