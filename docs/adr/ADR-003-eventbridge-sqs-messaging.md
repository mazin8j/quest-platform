# ADR-003 — EventBridge + SQS for asynchronous integration

## Status

Accepted (2026-09-04, Phase 00)

## Context

User requests must not wait for analytics, notifications, media processing or non-critical AI (CLAUDE.md rule 9). Modules need a way to react to each other's facts without direct coupling. Every background job must be idempotent and retry-safe (rule 12).

## Decision

Domain events use the envelope in `packages/events` (`eventId`, `eventType` `<context>.<aggregate>.<action>`, `eventVersion`, `occurredAt`, `aggregateType/Id`, `correlationId`, `causationId`, `actorId`, `source`, `dataClassification`, `payload`). Locally and in tests an in-process bus (`InMemoryEventBus`) delivers events; in AWS the publisher adapter targets an EventBridge custom bus and consumers read from SQS queues with dead-letter queues (Terraform `modules/messaging`). Handlers deduplicate on `eventId`. Publishing occurs after the owning transaction commits (transactional outbox to be added with the first cross-process consumer).

## Alternatives Considered

- **Kafka / MSK** — rejected for MVP: operational weight and cost far exceed the need; no ordering-heavy stream processing yet.
- **SNS + SQS only** — viable but EventBridge adds content-based routing, archive/replay and schema registry with no extra infra.
- **Database polling / cron** — rejected: latency and coupling.
- **BullMQ on Redis** — rejected: Redis would become a system of record for jobs, violating rule 11.

## Consequences

- Positive: managed, pay-per-use, replayable (archive), DLQ + alarms out of the box; domain code depends only on `EventPublisher`/`EventSubscriber` ports.
- Negative: at-least-once delivery requires idempotent handlers; no strict ordering (design events to be commutative or keyed).
- Security: event payloads carry identifiers, never PII beyond `actorId`; `dataClassification` gates what may leave the bus.

## Revisit Triggers

Need for ordered, high-throughput streams (> 5k events/s sustained), stream-processing joins, or multi-region replication of events.
