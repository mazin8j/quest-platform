---
name: recommendation-ranking
description: Use for For You, Nearby, Trending, World, Mystery, Quick Quest ranking or personalization.
---

# recommendation-ranking

## Use when

Use for For You, Nearby, Trending, World, Mystery, Quick Quest ranking or personalization.

## Inputs

Surface (For You / Nearby / Trending / World / Mystery / Quick), candidate sources, safety/age/location filters, feedback events.

## Workflow

1. Candidate generation → hard eligibility + safety/age/location filters → explainable scoring → exploration/diversity → creator fairness → repetition penalties.
2. Define feature inputs, cold start, offline metrics, online experiment metrics and guardrails (safety reports, hide/report rate).

## Guidance

Optimize for meaningful acceptance/completion and satisfaction under safety constraints, not passive watch time. Define candidate generation, hard eligibility filters, safety/age/location filters, feature inputs, scoring, exploration, diversity, creator fairness, repetition penalties, feedback loops, cold start, explanation fields, offline evaluation, online experiment metrics and guardrail metrics.

## Constraints

Never optimise watch time as north-star; only publishable (`ALLOWED*`/`RESTRICTED`-eligible) content enters candidates; AI ranking via gateway only.

## Done when / Exit criteria

Ranking spec with filters, scoring, explanation fields, metrics and guardrails; tests for filter correctness.
