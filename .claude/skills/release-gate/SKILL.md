---
name: release-gate
description: Use before staging/production release or when declaring a phase deployable.
---

# release-gate

## Use when

Use before staging/production release or when declaring a phase deployable.

## Inputs

Release candidate, environment, migration list, feature flags, dashboards/alerts, rollback plan.

## Workflow

1. Verify `pnpm verify`, integration tests, migration safety (expand/contract), configuration/secrets, security/safety reviews.
2. Confirm observability (dashboards, alarms), SLO/error budget impact, backup/recovery, rollback (ECS circuit breaker + migration revert), support/moderation readiness, post-release validation plan.

## Guidance

Verify build/type/lint/tests, migration safety, configuration/secrets, feature flags, security/safety review, observability dashboards/alerts, error budgets/SLO implications, backup/recovery, rollback, release notes, support/moderation readiness and post-release validation plan.

## Constraints

No release with open blocker/high findings; production applies require explicit human approval.

## Done when / Exit criteria

Release checklist completed with evidence; go/no-go recorded in `PROGRESS.md`.
