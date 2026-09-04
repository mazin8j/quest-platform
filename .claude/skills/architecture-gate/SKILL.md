---
name: architecture-gate
description: Use before structural changes, new services, databases, queues, major dependencies, or cross-domain architecture decisions.
---

1. Read CLAUDE.md, ARCHITECTURE_DECISIONS.md, relevant ADRs and modules.
2. Define the problem and measurable constraint.
3. Identify the smallest architecture change that solves it.
4. Compare at least two credible alternatives.
5. Analyze cost, operations, security, privacy, safety, latency, scaling, migration and rollback.
6. If structural, create/update an ADR.
7. Do not introduce a microservice merely for conceptual cleanliness.
