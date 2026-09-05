---
name: architecture-gate
description: Use before structural changes, new services, databases, queues, major dependencies, or cross-domain architecture decisions.
---

# architecture-gate

## Use when

Use before structural changes, new services, databases, queues, major dependencies, or cross-domain architecture decisions.

## Inputs

The proposed change, measurable constraint/problem, affected contexts; `CLAUDE.md`, ADRs, `DEPENDENCY_RULES.md`.

## Workflow

1. Read the constitution, ADR index and affected modules.
2. State the problem and the measurable constraint; identify the smallest change that solves it.
3. Compare at least two credible alternatives across cost, operations, security, privacy, safety, latency, scaling, migration and rollback.
4. If structural: write/update an ADR (Status, Context, Decision, Alternatives, Consequences, Revisit Triggers) and update `ARCHITECTURE_DECISIONS.md` and depcruise rules.

## Guidance

1. Read CLAUDE.md, ARCHITECTURE_DECISIONS.md, relevant ADRs and modules.
2. Define the problem and measurable constraint.
3. Identify the smallest architecture change that solves it.
4. Compare at least two credible alternatives.
5. Analyze cost, operations, security, privacy, safety, latency, scaling, migration and rollback.
6. If structural, create/update an ADR.
7. Do not introduce a microservice merely for conceptual cleanliness.

## Constraints

No microservice for conceptual cleanliness; no new datastore/queue/framework without an ADR; keep boundaries mechanically enforced.

## Done when / Exit criteria

Decision recorded (ADR or explicit 'no ADR needed' rationale), boundaries updated, reviewers named.
