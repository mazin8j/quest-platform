# QUEST Target Architecture

## Level 1 — System Context
Actors: consumer users, creators, moderators, brand users, administrators, external partners.

External systems: identity providers, maps/geocoding, push/email providers, AI providers, payment provider (future), wearables/fitness sources (future), analytics/observability platforms.

## Level 2 — Initial Containers
1. Mobile App — React Native/Expo
2. Public/Creator Web — Next.js
3. Admin/Moderation Web — Next.js
4. QUEST API — NestJS modular monolith
5. Async Workers — NestJS/Node workers
6. AI Gateway — logical service/package boundary, independently extractable
7. PostgreSQL — system of record
8. Redis — cache/hot counters/rate limits
9. S3-compatible Object Storage — images/video/evidence
10. EventBridge/SQS — asynchronous events and work queues
11. Observability — traces, metrics, structured logs, audit events

## Core Request Path
Client → CDN/WAF → API entry → authentication/authorization → domain module → PostgreSQL/Redis.

## Media Path
Client requests upload authorization → API validates policy → pre-signed upload → object storage → media event → worker performs scanning/transcoding/metadata extraction → CDN delivery.

## Quest Completion Path
1. User submits completion and evidence.
2. Participation module stores immutable submission reference.
3. `quest.proof.submitted` event emitted.
4. Safety/proof workers inspect evidence.
5. Verification decision recorded.
6. Reward transaction issued idempotently.
7. Passport/leaderboard/feed/notification updates happen asynchronously.

## AI Path
Domain module → AI Gateway → prompt/version registry → policy/safety checks → provider adapter → response validation → audit/evaluation telemetry → domain response.

No feature module may directly bind itself to a specific LLM provider.

## Extraction Triggers for Future Microservices
Extract a module only when one or more is true:
- independent scaling is repeatedly necessary
- distinct availability/SLO required
- regulatory/data residency boundary required
- independent team ownership requires deployment autonomy
- blast-radius reduction is materially valuable
- technology/data-store requirements truly diverge

Candidate future extractions: media processing, notifications, feed/recommendation, proof verification, AI Gateway, social graph, high-volume leaderboard/counter service.
