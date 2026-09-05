---
name: code-review
description: Use after meaningful code changes or before merging a feature.
---

# code-review

## Use when

Use after meaningful code changes or before merging a feature.

## Inputs

The diff, its tests, the feature note, affected ADRs/docs.

## Workflow

1. Check correctness, domain invariants, authorization, validation, error handling, concurrency/idempotency, migration safety, privacy, safety, performance, observability, tests, dependency risk, maintainability.
2. Run `pnpm verify` (and integration tests when data/API changed).
3. Classify findings: blocker, high, medium, low; require fixes for blocker/high before approval.

## Guidance

Review correctness, domain invariants, authorization, validation, error handling, concurrency/idempotency, data migration safety, privacy, safety, performance, observability, tests, dependency risk and maintainability. Classify findings: blocker, high, medium, low. Do not approve solely because tests pass.

## Constraints

Do not approve solely because tests pass; do not accept weakened tests; do not accept boundary violations even if depcruise was bypassed.

## Done when / Exit criteria

Written verdict with classified findings; blockers/highs resolved or explicitly escalated.
