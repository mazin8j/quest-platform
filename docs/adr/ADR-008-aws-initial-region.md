# ADR-008 — AWS single-region initial deployment in me-central-1 (UAE)

## Status

Accepted (2026-09-04, Phase 00) — with explicit assumptions and revisit triggers

## Context

QUEST launches in Jordan, then the GCC/MENA, with global expansion later. The platform will hold personal data, precise location (high sensitivity) and user media. AWS offers two Middle East regions: **me-south-1 (Bahrain, 2019)** and **me-central-1 (UAE, 2022)**. Jordan has no AWS region. Business/legal data-residency requirements for target GCC markets are **not yet confirmed**.

## Decision

Deploy the first environments in **me-central-1 (UAE)** as a single region, designed for later multi-region readiness (regional module inputs, no hardcoded region in code, S3/CloudFront for global delivery).

Evaluation:

| Criterion                                                                                                                            | me-central-1 (UAE)                                                                                                                | me-south-1 (Bahrain)                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Latency from Amman                                                                                                                   | ~40–60 ms (est.)                                                                                                                  | ~40–60 ms (est.) — comparable; both far better than eu-central-1 (~70–90 ms) |
| Service availability for our stack (ECS Fargate, RDS PG16, ElastiCache, S3, EventBridge, SQS, Secrets Manager, WAF, CloudFront edge) | Available                                                                                                                         | Available                                                                    |
| Managed AI (Bedrock) presence                                                                                                        | Announced/expanding in UAE; treat as **assumption** — QUEST uses a provider-independent gateway (ADR-004) so this is not blocking | More limited historically                                                    |
| Data residency / commercial perception                                                                                               | UAE is the GCC commercial hub; strongest signal for enterprise/brand partners and future KSA/UAE users                            | Acceptable, smaller market perception                                        |
| Operational maturity                                                                                                                 | Newer region; occasional capacity/feature lag                                                                                     | Older, slightly broader feature history                                      |
| Cost                                                                                                                                 | Both ~10–20 % above eu-central-1; similar to each other                                                                           | Similar                                                                      |
| Multi-region path                                                                                                                    | Pair with eu-central-1 (Frankfurt) or me-south-1 for DR                                                                           | Pair with me-central-1                                                       |

## Alternatives Considered

- **me-south-1 (Bahrain)** — strong runner-up; chosen against primarily on GCC commercial positioning and the UAE's growing AI/partner ecosystem. Kept as the DR/secondary candidate.
- **eu-central-1 (Frankfurt)** — best service breadth and cost, but higher latency and weaker regional data-residency story.
- **Multi-region from day one** — rejected: cost and complexity without users.

## Consequences

- Positive: low latency for the launch market, credible residency story for GCC, all Phase 00 services available.
- Negative: newer region may lag on niche features; must verify each new managed service before adopting it.
- Assumption recorded: no legal requirement mandates in-country hosting for Jordan users; GCC expansion may impose stricter rules.

## Revisit Triggers

(1) A confirmed legal/contractual residency requirement for a target market; (2) a required service unavailable in me-central-1; (3) > 30 % of DAU outside MENA; (4) measured p95 latency from Amman > 120 ms to the API; (5) a regional outage impacting SLOs.
