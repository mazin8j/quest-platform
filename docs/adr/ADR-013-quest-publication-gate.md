# ADR-013 — Quest publication is gated by a content hash and enforced in three layers

## Status

Accepted (2026-09-07, Phase 02)

## Context

A Quest is not a post. It is an instruction that another person — possibly a 13-year-old — will
carry out in the physical world. The product principle in `CLAUDE.md` is explicit: never encourage
dangerous, illegal, humiliating, exploitative, self-harm-related, sexual or reckless challenges.
Phase 00 shipped the Trust & Safety contract (`packages/types/src/safety.ts`) precisely so that the
phase which introduced publication could not ship without an enforcement point.

Phase 02 introduces that publication. The question this decision answers is what "a Quest may
become visible" is allowed to mean, and where that is decided.

Two properties are hard to get right and easy to lose later:

- **Approval belongs to content, not to a Quest id.** An owner who obtains an approval and then
  rewrites the instructions has content that nothing has ever assessed. A system that stores
  "quest 123 is approved" cannot tell the difference.
- **A single enforcement point is a single point of failure.** One missing check in one service
  method, one hand-written `UPDATE` during an incident, one future refactor that adds a second way
  to set a state, and dangerous content is public.

## Decision

**Approval is bound to a content hash.**

`canonicalQuestContent` (`packages/types/src/quest/content.ts`) serialises exactly the
safety-relevant fields — title, summary, instructions, safety notes, category, difficulty, evidence
requirement, eligibility and coarse location — in a fixed order, with whitespace normalised and
case preserved. `questContentHash` is SHA-256 over that string. Every assessment records the hash
it judged; publication records the hash it published. Deliberately excluded from the hash: duration
and visibility, because re-planning how long something takes is not a safety change and must not
cost the owner a re-review. Deliberately included: eligibility, because the audience is part of
what a safety decision is about.

Changing any safety-relevant field therefore produces a different hash, which makes every previous
approval detectably stale without anyone having to remember to invalidate it.

**Publication is refused unless all three layers agree.**

1. **The shared rule.** `canPublishWithAssessment` in `@quest/types` — deterministic, no I/O,
   shared with every client, and the only place that decides which safety states may be visible.
2. **The domain gate.** `evaluatePublish` (`apps/api/src/modules/quests/domain/quest.ts`) is a pure
   function taking the locked Quest row, the latest assessment, owner facts obtained through the
   Identity port, the caller, the hash the client believes it is publishing, and the maximum
   assessment age. It returns machine-readable blockers rather than a boolean, so a client can
   explain a refusal without parsing prose. It refuses on: a non-owner, an inactive owner, an
   unverified owner, a lifecycle state that does not permit publication, a client hash that does
   not match the stored one, a missing, stale or expired assessment, a safety state the shared rule
   rejects, and an age restriction stricter than the three-band model can express.
3. **The database.** `quest_published_requires_assessment` refuses any row with
   `state = 'PUBLISHED'` that lacks its assessment id, published hash, published version,
   publication timestamp or minimum age band — and requires the published hash to equal the current
   content hash. No code path, no migration and no manual `UPDATE` can produce a visible Quest
   without publication proof.

**Only one method publishes.** `QuestService.publish` is the sole writer of `PUBLISHED`, it
re-reads the row under `FOR UPDATE` before deciding, and it writes the assessment id and hash it
relied on in the same statement that sets the state. The lifecycle table
(`packages/types/src/quest/lifecycle.ts`) permits `PUBLISH` only from `DRAFT`: a Quest in review
must be revised and re-assessed, and a suspended Quest returns to `DRAFT`, never to visibility.

## Alternatives Considered

- **A boolean `approved` column.** Rejected: it cannot distinguish approved content from edited
  content, which is the failure mode that matters.
- **Storing the assessed content instead of a hash.** Rejected: it duplicates the content, and
  comparing two large JSON documents to answer "is this the same content" is slower and less
  obviously correct than comparing two hex strings.
- **Enforcement in the service layer only.** Rejected for the reason above: the database constraint
  costs one CHECK and removes a whole class of incident.
- **Hashing every column.** Rejected: an owner who extends their Quest's completion window would
  lose their approval, which teaches owners that safety review is arbitrary.
- **Blocking publication behind human review by default.** Rejected for Phase 02: it makes the
  product unusable before a moderation team exists. The deterministic rule engine
  (`RuleBasedSafetyDecision`) routes ambiguous content upward instead, and is itself fail-closed —
  any error, and any submission with no assessable text, yields `REVIEW_REQUIRED`.

## Consequences

- Positive: an approval cannot outlive the content it was about; there is one publication path; the
  database is the last line of defence rather than a bystander; refusals are machine-readable, so
  clients can guide an owner rather than showing an opaque error.
- Positive: the hash is computed from a shared function, so a client can predict a refusal before
  making the request.
- Negative: bumping `QUEST_CONTENT_HASH_VERSION` invalidates every stored approval at once. That is
  deliberate — it is the mechanism for "our policy changed, re-assess everything" — but it is a
  large operation and needs a migration plan when it happens.
- Negative: the rule engine's false positives cost owners a human review that no one can yet
  perform. Until Phase 14 provides a moderation queue, a Quest that lands in `IN_REVIEW` can only
  leave it through a corrected policy decision or an edit (BACKLOG TD-38).

## Revisit Triggers

- Phase 06 introduces AI classification: the AI may _produce_ an assessment, but this decision
  requires that the publish rule stay code. Revisit only if that ceases to hold.
- Phase 14 introduces the moderation queue and appeals; the `IN_REVIEW` exit path becomes a human
  workflow rather than a re-assessment.
- The first safety policy that needs an audience restriction the three-band age model cannot
  express (the gate currently refuses to publish rather than under-enforce it).
