# ADR-015 — Safety decisions have precedence by authority, and the decision in force is enforced on every read

## Status

Accepted (2026-09-12, Phase 02 gate remediation — final delta audit P1-2 and P1-3)

## Context

ADR-013 bound approval to a content hash and enforced it in three layers. It answered "was this
content assessed?" It did not answer two questions that only matter once more than one thing can
record a decision:

1. **When several decisions exist about the same content, which one is in force?** Phase 02 answered
   "the one with the greatest `seq`". That is correct for a single writer and wrong for three.
2. **What happens to a Quest that is already public when a blocking decision arrives?** Phase 02
   answered "the method that recorded it takes it down" — which works only for the one method that
   existed.

The final delta audit demonstrated both, over HTTP, against real staff endpoints.

**P1-2 — sanction laundering.** Trust & Safety suspends a Quest. `suspend()` records a HUMAN
`REVIEW_REQUIRED` for that exact content hash, precisely so the pre-suspension approval cannot be
reused (that was the P02-10 repair). Staff reinstate the Quest, which returns it to `DRAFT`. The owner
calls the ordinary assessment route on byte-identical content. The deterministic engine returns
`ALLOWED` — it must, it is a pure function of the text — that row now has the greatest `seq`, and
publish succeeds. The sanction is gone, and nothing anywhere recorded that it was overruled.

The earlier P02-37 repair had refused re-assessment while the Quest was `SUSPENDED`. After
reinstatement the state is `DRAFT`, which is indistinguishable from a legitimate publish, so no
state-based rule can close this. The defect is not in the lifecycle; it is in the resolution rule.

**P1-3 — a decision that was displayed instead of enforced.** A published Quest can receive a HUMAN
`REJECTED` for the content it has published, and stay `PUBLISHED`, listed in discovery, and
acceptable. The read path consults the latest assessment only to render a badge, so the API returned
`200` with `safety.state: "REJECTED"` and a `201` on accept — it told the viewer the content was
rejected and handed it to them anyway. `assess()` does take a Quest down when the _engine_ returns a
blocking outcome, so the repair for P02-09 was real; it covered one writer. `QuestSafetyAssessed` has
no consumer, and the moderation queue (Phase 14) and the AI decider (Phase 06) will both write
decisions no existing code path reacts to.

## Decision

### 1. Precedence by authority, applied as supersession

Authority is **HUMAN > AI > RULES**. The rule is about who may overturn whom, not about ranking
simultaneous opinions:

- a decision may be superseded only by one of **equal or higher** authority about the same content;
- so the decision in force is the latest decision made by the **highest authority that has spoken**
  about that content;
- a human decision therefore stands until another human revisits that content.

`effectiveAssessment(assessments, contentHash)`
(`apps/api/src/modules/quests/domain/safety-precedence.ts`) is the single implementation. It is pure,
takes the ledger rows for one content hash, and is unit-tested case by case.

Three properties are deliberate.

**It is not "the latest blocking decision wins."** A moderator who reviews content and clears it must
be able to release it, or refusal is the only human action the system respects — and the `IN_REVIEW`
exit that P02-21 was repaired to provide would be closed again.

**It is not "a human decision is final forever."** Its scope is one content hash. A safety-relevant
edit produces a different hash, and no earlier decision — human or machine — applies to content
nobody has judged. That is ADR-013's mechanism, unchanged and relied upon here.

**An unrecognised decider gets the lowest authority, not the highest.** A new decision source must be
given standing deliberately rather than inheriting it by being unknown.

A machine may still record an opinion about content a human has ruled on. The row is kept and a
moderator can see it; it does not take effect. Recording is not deciding.

### 2. The decision in force is enforced on every read

`questAccessFor` takes a `safetyPublishable` gate alongside `ownerEligible`: when the decision in
force for a Quest's **published** content does not permit publication, the Quest is `HIDDEN` — a 404
that names nothing, exactly as an ineligible owner produces. Discovery applies the same test inside
its refill loop, batched per page. Acceptance inherits it through `evaluateAcceptEligibility`, and
`start` / `completion-request` are refused with the same 409 an unpublished Quest gives. `cancel`
stays open.

This is defence in depth, and the load-bearing half. The write-side takedown in `assess()` remains —
it also cancels participations and moves the lifecycle state, which a read cannot do — but read-side
enforcement is what makes the invariant hold for writers that do not exist yet. A future moderation
queue that forgets to call a service method cannot leave dangerous content public; it can only fail
to tidy up after it.

The badge is computed from the same resolved decision as the gate, so a response can no longer say
`REJECTED` while granting access.

### 3. Visibility is computed, never stored

A blocking decision from a third-party writer conceals the Quest without mutating the row. The state
stays `PUBLISHED` and the publication proof is untouched, so a later human clearance restores
visibility on the next read with no republish, no backfill and no repair job.

This is the same architecture ADR-014 chose for owner eligibility, for the same reason: a stored flag
would need every writer to maintain it, and the drift would be silent. The owner and support still
see the Quest and still see the blocking badge, so the author can tell why their Quest went quiet.

## Alternatives Considered

**Resolve precedence in SQL.** A window function over `decided_by` could return the row in force in
one query. Rejected as the primary mechanism: the rule is a safety policy, and a policy that lives in
a query expression cannot be unit-tested case by case, cannot be shared, and is invisible to anyone
reading the domain layer. The repository returns the rows for one content hash — a bounded set, one
version of one Quest — and the pure function decides.

**Make `assess()` the only enforcement point (write-side only).** The audit's option A. Rejected
alone: it is what Phase 02 already had, and P1-3 is the proof that it holds only for writers that
remember to use it. Kept as the other half of the defence.

**Read-side only.** Simpler, and airtight for visibility. Rejected alone because a read cannot cancel
participations or move the lifecycle state, and a Quest that is concealed but still `PUBLISHED` with
live attempts is a half-applied takedown.

**Store a `safety_blocked` column maintained by every writer.** Rejected for ADR-014's reasons, plus
one more: it would be a second source of truth for a question the ledger already answers, and the
first disagreement between them would be invisible.

**Let a later blocking decision from any source win.** Simple and strictly safer in one direction, and
wrong: it makes human clearance impossible and reintroduces the `IN_REVIEW` dead end.

## Consequences

- Positive: a human sanction cannot be laundered by re-assessment, and no state transition can be
  arranged to make it possible.
- Positive: any writer of a blocking decision — including ones that do not exist yet — removes content
  from view, whether or not it calls the right service method.
- Positive: a decision and the access it governs cannot disagree, because both read the same resolved
  value.
- Positive: restoration needs no repair path. The row was never disturbed.
- Negative: two extra reads on the hot paths — one batched query per discovery pass, one per detail
  read. The batch shape is deliberate: the N+1 this avoids is the mistake P02-41 was repaired for.
- Negative: a Quest concealed by a third-party decision keeps `state = 'PUBLISHED'`, so the database
  alone no longer tells you whether a Quest is publicly visible. `/v1/quests/mine` shows the owner
  `PUBLISHED` with a blocking badge. Acceptable while no Phase 02 route can record such a decision;
  when Phase 14 ships a moderation queue, that queue must perform the full write-side takedown, and
  the lifecycle state should follow the decision.
- Negative: `AssessmentRecord` now carries `seq`, so the ordering key is part of the domain type
  rather than an implementation detail of the repository. That is honest — the rule genuinely depends
  on it — but it is one more thing a fixture must set.

## Revisit Triggers

- Phase 14 ships the moderation queue: it becomes the second real writer, and the write-side takedown
  must be part of it rather than an obligation recorded here.
- Phase 06 introduces AI decisions: `AI` gains standing above `RULES` in practice for the first time,
  and the "may an AI clear content a human blocked" answer (currently no) should be confirmed
  deliberately rather than inherited from this document.
- A third authority appears (an external regulator feed, an appeal outcome): the ladder needs a
  decision, not an addition to the map.
- The per-read cost of resolving the decision in force becomes measurable in the feed: the answer is
  a request-scoped cache, not a denormalised column.
