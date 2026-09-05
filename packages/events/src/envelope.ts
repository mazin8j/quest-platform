import { randomUUID } from 'node:crypto';

import { z } from 'zod';

/**
 * QUEST domain event envelope — the single wire format for every asynchronous integration
 * (in-process bus locally; EventBridge + SQS in AWS, see ADR-003).
 * Canonical documentation: docs/architecture/07_EVENT_ARCHITECTURE.md
 *
 * Naming: `<context>.<aggregate>.<past-tense-action>` in lower-kebab, e.g. `quest.proof.submitted`.
 * Payloads describe facts, never commands. Payloads carry identifiers, not user profiles.
 */
export const EVENT_TYPE_PATTERN = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*){2}$/;

export const eventTypeSchema = z
  .string()
  .regex(
    EVENT_TYPE_PATTERN,
    'Event type must be <context>.<aggregate>.<action> in lower-kebab-case',
  );

export const domainEventEnvelopeSchema = z.object({
  /** Globally unique event id (UUID). Consumers use it as the idempotency key. */
  eventId: z.uuid(),
  eventType: eventTypeSchema,
  /** Positive integer; bump on breaking payload changes. Consumers must ignore unknown fields. */
  eventVersion: z.number().int().positive(),
  /** ISO-8601 UTC. */
  occurredAt: z.iso.datetime(),
  aggregateType: z.string().min(1),
  aggregateId: z.string().min(1),
  /** Ties all events of one user request together. */
  correlationId: z.string().min(1),
  /** The eventId (or request id) that directly caused this event, if any. */
  causationId: z.string().min(1).optional(),
  /** Acting principal id (never a name/email). Omit for system-originated events. */
  actorId: z.string().min(1).optional(),
  /** Originating service/module, e.g. "api.participation". */
  source: z.string().min(1),
  /** Data classification of the payload; PII-bearing events require an explicit justification. */
  dataClassification: z
    .enum(['PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'RESTRICTED'])
    .default('INTERNAL'),
  payload: z.record(z.string(), z.unknown()),
});
export type DomainEventEnvelope<P extends Record<string, unknown> = Record<string, unknown>> = Omit<
  z.infer<typeof domainEventEnvelopeSchema>,
  'payload'
> & { payload: P };

/** Static definition of an event type: its name, version and payload schema. */
export interface DomainEventDefinition<P extends Record<string, unknown>> {
  readonly eventType: string;
  readonly eventVersion: number;
  readonly aggregateType: string;
  readonly payloadSchema: z.ZodType<P>;
  readonly dataClassification?: DomainEventEnvelope['dataClassification'];
}

export function defineEvent<P extends Record<string, unknown>>(
  definition: DomainEventDefinition<P>,
): DomainEventDefinition<P> {
  eventTypeSchema.parse(definition.eventType);
  return Object.freeze(definition);
}

export interface CreateEventOptions {
  aggregateId: string;
  correlationId: string;
  source: string;
  causationId?: string;
  actorId?: string;
  occurredAt?: Date;
  eventId?: string;
}

/** Construct a validated envelope for a defined event. Throws on invalid payload. */
export function createEvent<P extends Record<string, unknown>>(
  definition: DomainEventDefinition<P>,
  payload: P,
  options: CreateEventOptions,
): DomainEventEnvelope<P> {
  const validPayload = definition.payloadSchema.parse(payload);
  const envelope = {
    eventId: options.eventId ?? randomUUID(),
    eventType: definition.eventType,
    eventVersion: definition.eventVersion,
    occurredAt: (options.occurredAt ?? new Date()).toISOString(),
    aggregateType: definition.aggregateType,
    aggregateId: options.aggregateId,
    correlationId: options.correlationId,
    causationId: options.causationId,
    actorId: options.actorId,
    source: options.source,
    dataClassification: definition.dataClassification ?? 'INTERNAL',
    payload: validPayload,
  };
  return domainEventEnvelopeSchema.parse(envelope) as DomainEventEnvelope<P>;
}

/** Parse an untrusted inbound message (e.g. from SQS) into a typed envelope. */
export function parseEvent<P extends Record<string, unknown>>(
  definition: DomainEventDefinition<P>,
  raw: unknown,
): DomainEventEnvelope<P> {
  const base = domainEventEnvelopeSchema.parse(raw);
  if (base.eventType !== definition.eventType) {
    throw new Error(`Expected event type ${definition.eventType}, received ${base.eventType}`);
  }
  if (base.eventVersion > definition.eventVersion) {
    throw new Error(
      `Event ${base.eventType} v${base.eventVersion} is newer than the supported v${definition.eventVersion}`,
    );
  }
  return { ...base, payload: definition.payloadSchema.parse(base.payload) };
}
