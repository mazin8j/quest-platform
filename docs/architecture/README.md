# QUEST architecture documentation

Implementation-accurate as of Phase 00 (2026-09-04). Each document describes what exists in the
repository today and, where relevant, the agreed shape of what later phases add — clearly labelled.

| #   | Document                                                       | Scope                                                                     |
| --- | -------------------------------------------------------------- | ------------------------------------------------------------------------- |
| 01  | [System Context](01_SYSTEM_CONTEXT.md)                         | Actors, external systems, trust boundaries                                |
| 02  | [Container Architecture](02_CONTAINER_ARCHITECTURE.md)         | Deployable units and their runtime dependencies                           |
| 03  | [Component Architecture](03_COMPONENT_ARCHITECTURE.md)         | Inside `apps/api`: cross-cutting layers, ports, modules                   |
| 04  | [Domain Architecture](04_DOMAIN_ARCHITECTURE.md)               | Bounded contexts, ownership, interaction patterns                         |
| 05  | [Data Architecture](05_DATA_ARCHITECTURE.md)                   | PostgreSQL/PostGIS/pgvector, migrations, classification, retention        |
| 06  | [API Architecture](06_API_ARCHITECTURE.md)                     | Versioning, envelope, validation → see also `docs/api/API_CONVENTIONS.md` |
| 07  | [Event Architecture](07_EVENT_ARCHITECTURE.md)                 | Envelope, naming, local bus, EventBridge/SQS target                       |
| 08  | [AI Architecture](08_AI_ARCHITECTURE.md)                       | Gateway, tasks, prompts, routing, audit                                   |
| 09  | [Security Architecture](09_SECURITY_ARCHITECTURE.md)           | Controls implemented and planned                                          |
| 10  | [Trust & Safety Architecture](10_TRUST_SAFETY_ARCHITECTURE.md) | Enforcement contract → see `docs/security/QUEST_SAFETY_BASELINE.md`       |
| 11  | [Deployment Architecture](11_DEPLOYMENT_ARCHITECTURE.md)       | AWS topology from `infrastructure/terraform`                              |
| 12  | [Observability Architecture](12_OBSERVABILITY_ARCHITECTURE.md) | Logs, ids, metrics, tracing, CloudWatch                                   |
| 13  | [Scalability Architecture](13_SCALABILITY_ARCHITECTURE.md)     | Scaling levers and extraction triggers                                    |
| —   | [Dependency Rules](DEPENDENCY_RULES.md)                        | The enforced boundary rules (D-08)                                        |
