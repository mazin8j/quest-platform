# ADR-014 — Owner account lifecycle governs published content, through a synchronous Identity query port

## Status

Accepted (2026-09-11, Phase 02 gate remediation — audit finding P02-41 / BACKLOG TD-48)

## Context

Phase 02 shipped a publication gate that is thorough about the Quest and silent about its author.
ADR-013 binds approval to a content hash and enforces it in three layers, so a Quest cannot become
public without proof that _its content_ was assessed. Nothing in that gate re-examines the account
behind the content once publication has happened.

The Phase 02 gate audit found the consequence (P02-41). A Quest published by an account that is
subsequently `SUSPENDED`, `DEACTIVATED` or `DELETION_REQUESTED` stayed fully public: readable at its
detail endpoint, listed in discovery, and acceptable by new participants. Three of those are serious
in different ways:

- **`SUSPENDED`** is a staff sanction. Suspending an author who posts dangerous instructions while
  leaving those instructions live and acceptable makes the sanction decorative. This is the finding
  that makes P02-41 a gate blocker rather than a polish item.
- **`DEACTIVATED`** is the user asking to be invisible. Leaving their Quests public turns a control
  we offered them into a half-measure they did not agree to.
- **`DELETION_REQUESTED`** is the grace period before erasure. The window exists so the _user_ can
  change their mind, not so their content stays publicly actionable while they decide.

`DELETED` was already handled: the account-erasure cascade drives the owner's Quests to `ERASED`
inside the Identity deletion transaction. But that cascade runs once, at the end; it says nothing
about the states that lead up to it.

The question this decision answers is **how the Quest context learns whether an owner's content may
currently be public**, given the Phase 01 boundary that Quest Core must not read Identity tables,
must not duplicate Identity lifecycle logic, and must not trust anything about an owner that arrives
in a request.

## Decision

**Identity owns the policy and exposes it as a synchronous query port. Quest Core consumes the
answer and never interprets an account state.**

### The port

`OwnerEligibilityPort` (`apps/api/src/modules/identity/ports/owner-eligibility.port.ts`), provided
under the `OWNER_ELIGIBILITY` token by `IdentityModule` and backed by `AccountService`:

```ts
isPublicationEligible(accountId: string): Promise<boolean>;
publicationEligibilityFor(accountIds: readonly string[]): Promise<Map<string, boolean>>;
```

Three properties are deliberate.

- **It answers the policy question, not the state question.** `AccountFactsPort` already exposes
  "what state is this account in", and a caller handed a state inevitably writes its own rule over
  it — which is exactly the duplication the Phase 01 boundary forbids. This port answers "may this
  account's content be public", so `PUBLICATION_ELIGIBLE_STATES` is the single definition of the
  rule and Quest Core contains no mention of `SUSPENDED` at all.
- **Absence means ineligible.** An id the batch method does not resolve is missing from the map, and
  every caller reads a missing id as concealed. There is no shape of the answer that means "I could
  not establish this, so assume it is fine".
- **Batch is part of the contract, not an optimisation.** Discovery reads a page of Quests owned by
  many accounts. A single-lookup-only port would have made account state an N+1 on the hottest read
  in the product, and the first engineer to notice would have fixed it with a denormalised column.

An unknown state is ineligible, so a lifecycle state added to Identity later conceals content until
somebody decides otherwise. Concealment is reversible; disclosure is not.

### The enforcement points

- **Read.** `questAccessFor` takes `ownerEligible` and returns `HIDDEN` for an ineligible owner —
  after the owner and support checks, so neither the author nor moderation loses sight of the Quest,
  and before visibility, age band and everything else, so an ineligible owner's Quest is concealed
  for the same reason an unpublished one is. `HIDDEN` is already a **404**, never a 403: the status
  code must not distinguish "withdrawn" from "the author was suspended", and nothing in the response
  names the account, its state, or a reason.
- **Discovery.** One batched lookup per pass, folded into the existing `MAX_DISCOVERY_PASSES` refill
  loop that already filters blocked owners (audit P02-19). Because survivors are counted _inside_
  the loop and the keyset cursor advances over the rows actually read, dropping an ineligible owner's
  Quests shortens the underlying read and never the page the caller receives. Filtering after the
  fact — fetching `limit + 1` and removing rows — would have ended the feed early and made the rest
  of the catalogue unreachable, which is the defect P02-19 already recorded once.
- **Participation.** `accept` resolves eligibility with its other cross-context lookups and hands it
  to `evaluateAcceptEligibility`, where an ineligible owner is a _concealed_ refusal — the 404 the
  read endpoint gives, never an explained `403 OWNER_SUSPENDED`. `start` and `requestCompletion` are
  refused with the **same 409 message an unpublished Quest produces**, word for word, so "suspended
  author" and "withdrawn Quest" are indistinguishable to a participant.
- **Cancel stays open.** Deliberately. The alternative traps a participant in an attempt they can
  neither finish nor close, because of someone else's suspension. No Proof, XP, reward or
  gamification behaviour is defined here; Phase 02 has none, and this decision invents none.

### Failure and reactivation

A lookup that throws is counted (`quest.core.owner_eligibility_unavailable`) and reported as
ineligible. An unanswered question is not permission: a Quest is concealed rather than disclosed on
the strength of a broken dependency.

Reactivation needs no new mechanism, which is the point. Eligibility is computed per request from
live account state, so an account returning to `ACTIVE` restores visibility on the next read — but
only for Quests whose _own_ proof is still valid, because ADR-013's three layers are untouched and
still decide publication. A Quest suspended by Trust & Safety, archived, erased, or whose assessment
went stale or was rejected while the owner was away stays concealed by its own gate. Owner
eligibility is a necessary condition added on top of the publication gate, never a replacement for
it, so reactivation cannot resurrect a stale or rejected approval.

## Alternatives Considered

**A. Event consumer in Quest Core.** Identity publishes `identity.account.suspended` and friends;
Quest Core keeps its own view and filters on it.

Rejected. It is correct only if no event is ever missed, and Phase 02 has no transactional outbox —
`packages/events` is an in-process bus, and the outbox is still a pending decision in the ADR index.
A dropped event leaves a suspended author's content public with nothing to detect it, and the
recovery story is a reconciliation job that has to read the truth synchronously anyway. Fail-open on
missed delivery is the wrong direction for a safety sanction. It also inverts the coupling: Quest
Core would hold a replica of Identity's lifecycle, which is the duplication the boundary forbids.

**B. Denormalised `owner_eligible` flag on the `quest` table.** Fastest to read: discovery filters in
SQL with no extra query and no refill arithmetic.

Rejected as the primary mechanism. It is option A's correctness problem plus a write-amplification
problem: suspending an account with 5,000 Quests becomes 5,000 row updates, and the flag is stale
between the state change and the last update — a race window measured in whatever the backfill takes,
during which the sanction is partially applied. It also puts a fact Identity owns in a Quest column,
where the next context that needs it will copy it again.

**C. Synchronous Identity query port (chosen).** One batched query per discovery page, one per detail
read.

Accepted. There is no missed-event class of bug because there are no events; there is no staleness
window because the answer is read from the authoritative table at request time; the policy lives in
exactly one place; and the batch method keeps the cost at O(1) queries per page. The cost is a
synchronous dependency on Identity in the read path and a cross-context call per request. Both are
acceptable in a modular monolith (ADR-001) where the call is an in-process method against the same
database, and the port is the seam that makes them replaceable later.

**D. Hybrid — port for correctness, denormalised flag as a read cache maintained by events.**

Rejected for Phase 02, not on principle. It is the right shape at the scale where option C's per-page
query hurts, but it can only be built once there is a transactional outbox to make the events
reliable and a reconciliation job to repair drift. Adopting it now would mean shipping option A's
failure modes for a performance problem we cannot yet measure. Recorded as a revisit trigger.

## Consequences

- Positive: a suspension takes the author's content down with them, in every surface, without a job
  running or an event arriving.
- Positive: reactivation is automatic and cannot over-restore, because publication proof is still
  enforced independently by ADR-013.
- Positive: the Quest context contains no account-lifecycle vocabulary, so the Phase 01 boundary is
  stronger after this change than before it. `pnpm deps:check` still forbids Quest Core from
  importing Identity persistence; only the port's token and type cross the line.
- Negative: discovery and detail now depend on Identity being readable. The dependency fails closed,
  which means an Identity outage degrades the public feed to empty rather than serving stale content.
  That is the correct direction for a safety control and the wrong direction for availability; the
  metric exists so the trade is visible.
- Negative: one extra query per detail read and per discovery pass. Measured against the alternative
  of a wrong answer, this is cheap; measured at scale it is the thing option D exists to remove.
- **Known race, accepted.** Eligibility is resolved immediately before the transaction that writes a
  participation transition, not inside it, so that no row lock is held while another context is
  queried. An account suspended in the microseconds between the lookup and the commit can therefore
  see one already-accepted participant advance one step. The next request re-checks, and the Quest is
  concealed from everyone else immediately, so the window cannot be used to gain access — only to
  finish a step already in progress. Holding the participation row lock across a cross-context call
  to close a window this narrow trades a real deadlock and pool-starvation risk for a theoretical
  one.
- Negative: two ports now answer questions about accounts (`ACCOUNT_FACTS`, `OWNER_ELIGIBILITY`).
  That is intentional — facts and policy are different things — but a third would be a smell.

## Revisit Triggers

- A transactional outbox is adopted (currently a pending decision): option D becomes buildable, and
  the synchronous read can become a cache with an authoritative fallback.
- Identity is extracted into its own service: the synchronous call becomes a network hop in the feed
  path, and the per-page batch becomes a per-page RPC. The port is already the seam; the decision to
  revisit is about latency budget, not about shape.
- A second consumer needs owner eligibility (Feed, Discovery ranking, Crews). If three contexts ask
  the same question per request, the answer belongs in a shared request-scoped cache before it
  belongs in a denormalised column.
- Any future lifecycle state whose correct answer is "content stays public while the account is in
  it" — the allow-list is currently `ACTIVE` alone, and widening it is a safety decision, not a
  refactor.
