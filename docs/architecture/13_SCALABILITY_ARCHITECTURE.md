# 13 — Scalability Architecture

## Levers available without changing architecture

1. **Horizontal API scaling** — stateless tasks behind the ALB; autoscaling on CPU (Terraform);
   switch the throttler to Redis storage when replicas > 1.
2. **Read replicas** for PostgreSQL; connection pooling (pgbouncer/RDS Proxy) when connections >
   ~500.
3. **Redis** for hot counters, leaderboards and caches (never source of truth) — already isolated
   behind a module token.
4. **Asynchronous work** through EventBridge/SQS workers scaled independently of the API (same
   image, different entrypoint).
5. **Media** never touches the API; S3 + CloudFront scale independently.
6. **Edge caching** for public quest content via CloudFront cache policies (path-based).

## Extraction triggers (from ADR-001)

Extract a module into its own service only when at least one is measured, not predicted:

- sustained need to scale it independently (CPU/memory profile diverges from the API);
- distinct availability/SLO requirement;
- regulatory or data-residency isolation;
- a separate team needs deployment autonomy;
- blast-radius reduction justified by an incident.

Candidate order: media processing → notifications → feed/recommendation → proof verification →
AI Gateway → social graph → hot-counter service. The dependency-cruiser boundaries make each
extraction a move of one folder plus an adapter for its port.

## Capacity assumptions to validate (Phase 10/16)

World Quest bursts (counters), evidence uploads (S3 throughput), recommendation fan-out. Load
tests are planned per phase skill; Phase 00 fixes the measurement plumbing (metrics/tracing seams).
