# QUEST Trust & Safety baseline (Phase 00)

**Why now**: Quests become publishable in Phase 02, twelve phases before the full Trust & Safety
hardening in Phase 14 (audit finding D-10). This baseline fixes the _contract_ so nothing can be
published without passing through a safety decision, and so later engines (rules, AI, human)
produce interchangeable records.

Implemented in code: `packages/types/src/safety.ts` (17 tests) and
`apps/api/src/modules/trust-safety` (fail-closed default, 3 tests).

## Policy states (`SafetyPolicyState`)

| State                  | Meaning                                                                                      | Publishable? |
| ---------------------- | -------------------------------------------------------------------------------------------- | ------------ |
| `UNASSESSED`           | no assessment for the current content version                                                | **No**       |
| `ALLOWED`              | allowed without conditions                                                                   | Yes          |
| `ALLOWED_WITH_WARNING` | allowed; participant sees a warning/disclaimer (`restrictions.requiresWarningText`)          | Yes          |
| `RESTRICTED`           | allowed only for a restricted audience (`minimumAge`, `blockedCountries`/`allowedCountries`) | Yes (gated)  |
| `REVIEW_REQUIRED`      | blocked pending human review                                                                 | **No**       |
| `REJECTED`             | rejected by policy; appealable                                                               | **No**       |
| `ESCALATED`            | rejected and escalated (imminent harm/illegal); not self-service appealable                  | **No**       |

Names were chosen over the suggested `SAFE/REQUIRES_WARNING/REQUIRES_REVIEW` to make the
publishability of `RESTRICTED` explicit and to separate `REJECTED` (appealable) from `ESCALATED`.

## Risk categories (`SafetyRiskCategory`)

Mandated: dangerous physical activity, illegal behavior, self-harm, violence, drugs, alcohol,
dangerous driving, minors, bullying, harassment, sexual content, dangerous location, trespassing.
Added: weapons, privacy invasion, humiliation/coercion. Each signal carries a `score` 0–1 and a
non-PII `rationale`.

## The enforcement contract

1. Every assessable subject (Quest first; later comments, media, crews) has a
   `subjectContentVersion` (hash of the assessed text/fields). Editing content produces a new
   version → the subject is `UNASSESSED` again until re-assessed.
2. `SafetyDecisionPort.assess(input)` returns an append-only `SafetyAssessment` with
   `policyVersion`, `decidedBy` (`RULES` | `AI` | `HUMAN`), signals, optional restrictions and, for
   AI, an `aiInvocationRef` into the AI audit store. Reconsideration creates a new record with
   `supersedesAssessmentId`.
3. **Publish rule (deterministic, code, not model)**:
   `canPublishWithAssessment(latestAssessment, currentContentVersion)` must return `allowed: true`
   before any transition to PUBLISHED. The Quest aggregate persists the `assessmentId` it relied on.
4. **Fail-closed**: implementations return `REVIEW_REQUIRED` on any error, timeout or missing
   policy. The Phase 00 implementation returns `REVIEW_REQUIRED` for everything, so wiring Phase 02
   before a real engine exists cannot publish anything.
5. Inputs never include precise coordinates (country code only) or identity data; whether the
   audience may include minors is a boolean.
6. AI (Phase 06) may _suggest_ a state through `classifyQuestSafety`; the rule engine/human decides.
   High-severity signals (self-harm, minors + sexual content, weapons, imminent harm) always route
   to `REVIEW_REQUIRED` or `ESCALATED` regardless of model confidence.

## Phase obligations

| Phase            | Must deliver                                                                                                                                                                     |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 02 Quest Core    | Rule-based `SafetyDecisionPort` (keyword/pattern + category thresholds), publish gate wired, `safety.assessment.recorded` event, tests proving no publish path bypasses the rule |
| 03 Social        | Report entity (`subjectType`, reporter id, category, free text with PII minimisation), block/mute precedence                                                                     |
| 05 Media/Proof   | Media scanning hook produces assessments for evidence                                                                                                                            |
| 06 AI            | `classifyQuestSafety` behind the gateway with `FAIL_CLOSED` fallback; eval corpus                                                                                                |
| 14 T&S hardening | Versioned policy taxonomy, moderator queues, appeals, sanctions, transparency reports, adversarial test corpus, FP/FN measurement                                                |

## A sanction on an author is a sanction on their content

Assessments judge content; suspensions judge accounts. Phase 02's gate did the first thoroughly and
the second not at all, so suspending an author left their instructions public and acceptable
(audit P02-41). The rule, from the Phase 02 gate remediation onward:

- content is public only while its author's account is eligible to have public content, and whether
  a given lifecycle state means that is **Identity's** judgement, asked per request through
  `OWNER_ELIGIBILITY` (ADR-014) — no context re-derives it and nothing caches it;
- an answer that cannot be established is not permission, and conceals;
- concealment is a 404 that names no account, no state and no reason — an explained concealment is
  an oracle;
- the author keeps sight of their own work and moderation keeps sight of what it withdrew;
- a participant already in flight can always `cancel`, and can advance no further;
- returning to good standing restores visibility **only** where the Quest's own ADR-013 proof is
  still valid. Reinstatement is not an amnesty for a rejected, stale, suspended, archived or erased
  Quest.

## Non-negotiables

Never encourage dangerous, illegal, humiliating, exploitative, self-harm-related, sexual or reckless
challenges (CLAUDE.md). Safety overrides growth incentives. Minors and precise location get elevated
controls (see `docs/security/PRIVACY_PRINCIPLES.md`). A sanction that does not reach the sanctioned
person's content is not a sanction.
