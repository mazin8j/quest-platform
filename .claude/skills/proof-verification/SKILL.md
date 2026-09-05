---
name: proof-verification
description: Use for Quest evidence, media verification, GPS/sensor validation, fraud detection, or completion decisions.
---

# proof-verification

## Use when

Use for Quest evidence, media verification, GPS/sensor validation, fraud detection, or completion decisions.

## Inputs

Quest evidence requirements, evidence types, available signals (media metadata, geospatial/time, device), risk of fraud.

## Workflow

1. Design layered evidence: deterministic validation → media integrity → geo/time consistency → device signals → duplicate/reuse detection → AI analysis (via gateway, confidence only) → thresholds → human review for high impact → appeal path.
2. Preserve source metadata, consent and retention rules; record verification decisions append-only.

## Guidance

Design proof as layered evidence rather than a single AI verdict. Preserve source metadata, consent and retention rules. Combine deterministic validation, media integrity signals, geospatial/time consistency, device/sensor signals when available, duplicate/reuse detection, AI analysis where appropriate, confidence thresholds, human review for high-impact cases, and an appeal/reconsideration path.

## Constraints

AI confidence is never a final verdict; precise location used only for verification and retained per privacy policy.

## Done when / Exit criteria

Verification pipeline spec with thresholds, review routing, audit records and tests for fraud/duplicate cases.
