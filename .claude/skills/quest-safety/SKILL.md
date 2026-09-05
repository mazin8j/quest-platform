---
name: quest-safety
description: Use whenever a feature creates, recommends, modifies, shares, verifies, ranks, or promotes user challenges.
---

# quest-safety

## Use when

Use whenever a feature creates, recommends, modifies, shares, verifies, ranks, or promotes user challenges.

## Inputs

The feature that creates/recommends/modifies/shares/verifies/ranks/promotes challenges; `docs/security/QUEST_SAFETY_BASELINE.md`; `@quest/types` safety contract.

## Workflow

1. Enumerate risk categories touched (`SafetyRiskCategory`), audience (minors?), geography.
2. Define the outcome mapping to `SafetyPolicyState` and restrictions; ensure the path calls `SafetyDecisionPort` and `canPublishWithAssessment` before visibility.
3. Log `policyVersion`, define appeal path and escalation; add fail-closed tests.

## Guidance

Perform challenge-specific safety review. Check dangerous physical behavior, illegal acts, trespass, driving risk, harassment, humiliation, self-harm, violence, sexual content/activity, drugs/alcohol, weapons, minors, dangerous locations, privacy invasion, coercion and copycat risk. Define outcome: allow, allow-with-restrictions, age/geography restrict, human review, reject, emergency/escalation. Log policy version and appeal path where appropriate.

## Constraints

Fail-closed on error; AI suggests, rules/humans decide; high-severity categories always route to review/escalation.

## Done when / Exit criteria

Enforcement point exists in code with tests proving no bypass; policy version recorded; appeal/escalation documented.
