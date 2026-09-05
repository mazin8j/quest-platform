---
name: feature-implementation
description: Use when implementing any nontrivial QUEST product feature end-to-end.
---

# feature-implementation

## Use when

Use when implementing any nontrivial QUEST product feature end-to-end.

## Inputs

Requirement and acceptance criteria (G0), affected modules, schema/API/event impact, security/privacy/safety impact, telemetry, rollout plan.

## Workflow

1. Write a short implementation note covering the inputs above and the test plan.
2. Implement the smallest coherent vertical slice inside the owning module(s) respecting `DEPENDENCY_RULES.md`.
3. Run targeted tests, then `pnpm verify`; add telemetry and feature flag where risky.
4. Update docs, `PROGRESS.md`, `BACKLOG.md`.

## Guidance

Before coding, write a short implementation note covering requirement, acceptance criteria, affected modules, schema/API/events, security/privacy/safety, tests, telemetry and rollout. Implement the smallest coherent vertical slice. Run targeted tests first, then broader quality gates. Update docs and progress files.

## Constraints

No later-phase functionality; no business rules in clients or controllers; no bypass of the safety publish rule.

## Done when / Exit criteria

Acceptance criteria demonstrably met by tests; quality gates G0–G3 satisfied; docs and progress files updated.
