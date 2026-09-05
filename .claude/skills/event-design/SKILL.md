---
name: event-design
description: Use when adding asynchronous workflows, domain events, queues, workers, retries, or integration events.
---

# event-design

## Use when

Use when adding asynchronous workflows, domain events, queues, workers, retries, or integration events.

## Inputs

Producer context, the fact being announced, consumers, ordering/idempotency needs; `07_EVENT_ARCHITECTURE.md`; `packages/events`.

## Workflow

1. `defineEvent` with `<context>.<aggregate>.<action>`, version, aggregateType, payload schema (ids + facts only), dataClassification.
2. Publish after commit via `EVENT_PUBLISHER`; document consumers, idempotency key (eventId), retry/DLQ and failure ownership.
3. Add tests: envelope validity, handler idempotency on redelivery, version tolerance.

## Guidance

Define producer, consumer(s), schema/version, partition/order requirements if any, idempotency key, retry/backoff, dead-letter handling, observability, PII classification, replay safety and failure ownership. Events should describe facts, not remote procedure calls.

## Constraints

Events describe facts, not commands; no RESTRICTED data in payloads; no synchronous RPC disguised as an event.

## Done when / Exit criteria

Event definition, publisher call site, consumer(s), tests and catalogue entry in `07_EVENT_ARCHITECTURE.md` exist.
