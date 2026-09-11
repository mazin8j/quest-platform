# Quest & participation API (v1)

Machine-readable contract: `docs/api/openapi/v1.json` (generated from `@quest/types`, ADR-012;
`pnpm --filter @quest/api openapi:generate`). Conventions: `API_CONVENTIONS.md`. Authentication and
account states: `IDENTITY_API.md`. Client SDK: `@quest/api-client` `questsApi()`, which mirrors the
paths below and cannot express an owner or a state, because the server owns both.

## The model in one paragraph

A Quest is a governed challenge, not a post. It is drafted, assessed for safety, published, and
optionally archived; a participant accepts it, starts it, and declares completion. Two invariants
run through every route. Ownership is derived from the access token — no request body carries an
owner id. Visibility is earned: only `POST /v1/quests/:questId/publish` sets `PUBLISHED`, and only
when the publish gate (`evaluatePublish`) allows it. States are `DRAFT`, `IN_REVIEW`, `PUBLISHED`,
`ARCHIVED`, `SUSPENDED`, `ERASED`; attempts are `ACCEPTED`, `STARTED`, `COMPLETION_REQUESTED`,
`CANCELLED`, `EXPIRED`.

Safety approval belongs to _content_, not to a Quest id. The API hashes the safety-relevant fields
(`canonicalQuestContent`, SHA-256) into `contentHash`; an assessment records the hash it judged, and
the gate refuses to publish content whose hash differs. This is why editing a published Quest's
instructions unpublishes it, and why `expectedContentHash` is mandatory on publish.

## Endpoints

| Area      | Method & path                                       | Auth / notes                                                                                                      |
| --------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| authoring | `POST /v1/quests`                                   | `MANAGE_OWN_QUESTS` · verified email · 20/min · 201 `QuestDetail` in `DRAFT`; 409 at `QUEST_MAX_ACTIVE_PER_OWNER` |
| authoring | `PUT /v1/quests/:questId`                           | `MANAGE_OWN_QUESTS` · 30/min · full replacement + `expectedRevision`; a safety-relevant change unpublishes        |
| authoring | `POST /v1/quests/:questId/assessment`               | `MANAGE_OWN_QUESTS` · 10/min · records a decision about the current hash; never publishes                         |
| authoring | `POST /v1/quests/:questId/publish`                  | `MANAGE_OWN_QUESTS` · verified email · 10/min · `expectedContentHash`; 409 lists machine-readable blockers        |
| authoring | `POST /v1/quests/:questId/archive`                  | `MANAGE_OWN_QUESTS` · optional `reason` (≤ 500) · cancels every in-flight attempt                                 |
| discovery | `GET /v1/quests`                                    | public · 60/min · published, `PUBLIC`, within availability, newest first, unranked                                |
| discovery | `GET /v1/quests/mine`                               | `MANAGE_OWN_QUESTS` · the caller's own Quests in every state                                                      |
| discovery | `GET /v1/quests/:questId`                           | public · 60/min · `QuestDetail`; 404 whenever the caller may not know it exists                                   |
| catalogue | `GET /v1/quest-categories`                          | public · 60/min · active categories (`key`, `label`, `sortOrder`) from the database                               |
| take part | `POST /v1/quests/:questId/participation`            | `PARTICIPATE_IN_QUESTS` · 30/min · optional `expectedPublishedVersion` · 201 `ParticipationView`                  |
| take part | `GET /v1/me/participations`                         | `PARTICIPATE_IN_QUESTS` · keyset-paged, newest acceptance first                                                   |
| take part | `POST /v1/me/participations/:id/start`              | `PARTICIPATE_IN_QUESTS` · 30/min · opens the completion window                                                    |
| take part | `POST /v1/me/participations/:id/completion-request` | `PARTICIPATE_IN_QUESTS` · 30/min · optional `note` (≤ 1000) · terminal in Phase 02                                |
| take part | `POST /v1/me/participations/:id/cancel`             | `PARTICIPATE_IN_QUESTS` · abandons an `ACCEPTED` or `STARTED` attempt                                             |
| staff     | `GET /v1/admin/quests/:questId`                     | `VIEW_QUEST_SUPPORT` · `QuestSupportView` with up to 20 assessments and a participation count                     |
| staff     | `POST /v1/admin/quests/:questId/suspend`            | `SANCTION_QUEST` · `reason` 5–500 chars · withdraws visibility and cancels attempts                               |
| staff     | `POST /v1/admin/quests/:questId/reinstate`          | `SANCTION_QUEST` · returns the Quest to `DRAFT`, never straight back to visibility                                |

`MANAGE_OWN_QUESTS` and `PARTICIPATE_IN_QUESTS` are self-service permissions held by the `USER`
role. `SUPER_ADMIN`, `TRUST_SAFETY_LEAD` and `MODERATOR` hold both staff permissions; `SUPPORT`
holds `VIEW_QUEST_SUPPORT` but not `SANCTION_QUEST`; `ANALYST` and `READ_ONLY` hold neither. Staff
roles carry no self-service permissions, so a moderator cannot author or accept Quests with them.

## Authoring lifecycle

`POST /v1/quests` takes `content`, `duration` and `visibility` (`PUBLIC` by default) and always
returns a `DRAFT`. An unknown `content.categoryKey` is a 400 naming that path; an account that
already holds `QUEST_MAX_ACTIVE_PER_OWNER` non-terminal Quests (default 50) gets a 409 telling it to
archive one first, because the per-minute throttle alone would still permit tens of thousands a day.

`PUT /v1/quests/:questId` replaces the whole editable state rather than patching it — a partial edit
would make the content hash ambiguous. Editing `visibility` or `duration` leaves a published Quest
published, since no safety decision rests on them. Editing anything the hash covers moves the Quest
back to `DRAFT`, clears its publication proof, and cancels every attempt that was accepted under the
terms that no longer exist publicly. `ARCHIVED` and `SUSPENDED` Quests cannot be edited (409).

`POST /v1/quests/:questId/assessment` records an append-only decision about the Quest's _current_
content and returns `QuestAssessmentView` — including `publishable`, which says whether that
decision permits publication of that hash right now. A decision is not advice, so the outcome may
move the Quest: an unpublishable decision takes a `PUBLISHED` Quest to `IN_REVIEW` (cancelling its
attempts) and a `DRAFT` to `IN_REVIEW`, and a favourable one releases an `IN_REVIEW` Quest back to
`DRAFT` so a transient engine failure cannot park a Quest forever. `ARCHIVED` and `SUSPENDED` Quests
keep their state; the decision is still recorded for moderators. If the content changes while the
policy engine is running, the request fails with 409 rather than attributing the decision to content
it did not see.

`POST /v1/quests/:questId/archive` is the owner's retirement path. It cancels in-flight attempts and
clears the publication proof.

## Publish, and the blockers a 409 carries

Publication fails closed. A refusal is a 409 whose `issues[]` entries each carry `path: "publish"`
and a blocker code as the `message`, so a client can explain the refusal without parsing prose. The
same codes appear in `QuestDetail.publishBlockers` for the owner's own view, which is how a client
can show what is wrong _before_ the owner presses publish. That array is `null` for anyone but the
owner, and empty for a Quest that is already published with its current content.

| Blocker                              | Meaning                                                                                                                                |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| `NOT_OWNER`                          | the authenticated principal does not own this Quest                                                                                    |
| `OWNER_NOT_ACTIVE`                   | the owner's account is not `ACTIVE` (suspended, deactivated, pending deletion)                                                         |
| `OWNER_EMAIL_NOT_VERIFIED`           | the owner's email address is unverified                                                                                                |
| `INVALID_STATE_<STATE>`              | the lifecycle forbids publishing from this state; only `DRAFT` may publish, so `IN_REVIEW` must be revised first                       |
| `CONTENT_HASH_MISMATCH`              | `expectedContentHash` differs from the stored hash — the Quest was edited elsewhere since the client read it                           |
| `NO_SAFETY_ASSESSMENT`               | no assessment has ever been recorded for this Quest                                                                                    |
| `SAFETY_ASSESSMENT_STALE`            | the latest assessment judged different content (a different hash)                                                                      |
| `SAFETY_ASSESSMENT_EXPIRED`          | the assessment is older than `QUEST_ASSESSMENT_MAX_AGE_DAYS` (default 30) even though the hash still matches                           |
| `SAFETY_<STATE>`                     | the assessment's own state forbids publication — `SAFETY_UNASSESSED`, `SAFETY_REVIEW_REQUIRED`, `SAFETY_REJECTED`, `SAFETY_ESCALATED`  |
| `SAFETY_AGE_RESTRICTION_UNSUPPORTED` | the assessment demands a minimum age above 18, which the three-band model cannot express; refusing is safer than silently applying 18+ |

Several blockers can be returned at once; they are evaluated independently, not short-circuited.
`ALLOWED`, `ALLOWED_WITH_WARNING` and `RESTRICTED` are publishable safety states, so they never
appear here. A successful publish increments `publishedVersion`, snapshots the content, and stores
the assessment id it relied upon — a database CHECK refuses a `PUBLISHED` row without one.

The age band a Quest publishes with is the stricter of the owner's declared band and any minimum the
assessment imposed, and it is that published band — not the editable draft `eligibility` — that
governs who sees and accepts the Quest afterwards.

## Discovery and detail

`GET /v1/quests` returns `PUBLISHED`, `PUBLIC` Quests inside their availability window, newest
first, with keyset pagination (`cursor`, `limit` 1–50, default 20) and optional `categoryKey` and
`difficulty` filters. It is deliberately unranked: recommendation is a later phase and an unowned
ranking here would quietly become the product's algorithm. The route is public, but a bearer token
is still read when present, so a signed-in caller additionally gets Quests by blocked owners removed
and a `participating` flag on each card. Age-gated Quests are filtered by the _published_ band; an
anonymous caller therefore only ever sees Quests published at the platform's lowest band.

Quests whose **owner account is no longer eligible** to have public content — suspended, deactivated
or pending deletion, as Identity judges it through `OWNER_ELIGIBILITY` (ADR-014) — are absent from
the list for every caller, including anonymous ones. The eligibility of a whole page of owners is
resolved in one batched Identity query per pass and folded into the same refill loop that removes
blocked owners, so removing them shortens the underlying read and never the page you receive:
`limit` still means `limit`, and the cursor still advances over every row considered.

`GET /v1/quests/:questId` answers 404 wherever the caller may not know a Quest exists: someone
else's draft, a suspended or archived Quest, a `PRIVATE` one, a Quest whose owner is blocked either
way, a Quest whose published age band the viewer does not satisfy, and a Quest whose **owner account
is not currently eligible** to have public content. That last case is indistinguishable from the
others by design: the response carries no account state, no owner metadata and no reason, because a
404 that explains itself is a 403 wearing a different number. Age restriction hides rather
than merely refusing acceptance, because the instructions are the dangerous part — greying out a
button would still show a 14-year-old how to do the thing. A 403 in any of these cases would confirm
existence, which is exactly what the caller must not learn.

Owners see three extra fields on their own Quests: `contentHash`, `publishedContentHash` and
`publishBlockers`. Staff holding `VIEW_QUEST_SUPPORT` can read a Quest in any state — including one concealed because
its owner is ineligible, which is the whole point of a support view — but those owner-integrity
fields stay `null` for them; the support view is the route for staff work. An `ERASED` Quest is 404
for everyone, support included: there is nothing left in it to inspect.

`QuestDetail.safety` is a badge, not a verdict about the draft: it is populated only when the latest
assessment matches the content that is actually published (or, for an unpublished Quest, its current
content). A newer assessment of edited draft content says nothing about what is public, so it is
withheld rather than shown. `warning` carries the text a `RESTRICTED` or `ALLOWED_WITH_WARNING`
outcome requires participants to see.

## Participation

`POST /v1/quests/:questId/participation` evaluates eligibility server-side and freezes the accepted
`publishedVersion` on the record, so a later edit by the owner cannot change terms somebody already
agreed to. Read access is a precondition, not a parallel check: a Quest the caller may not see is a
404, and only refusals about a Quest they may legitimately see come back as an explained 403 of the
form `Not eligible: <REASONS>`. The reasons are `AUTHENTICATION_REQUIRED`, `BLOCKED`,
`OWNER_CANNOT_PARTICIPATE`, `QUEST_NOT_PUBLISHED`, `QUEST_NOT_OPEN`, `OUTSIDE_AVAILABILITY_WINDOW`,
`EMAIL_NOT_VERIFIED`, `AGE_RESTRICTED`, `COUNTRY_BLOCKED`, `COUNTRY_NOT_ALLOWED` and
`COUNTRY_UNKNOWN`. The last exists because a country restriction that cannot be checked against a
viewer fails closed rather than open. An ineligible owner produces the concealed 404, never a reason
code: there is no `OWNER_SUSPENDED` in that list and there deliberately never will be. Country rules are the owner's declared lists folded with the
published assessment's restrictions, so the geographic half of a `RESTRICTED` decision is enforced
and not merely recorded.

A second active attempt on the same Quest is a 409, enforced by a unique index rather than by a
read-then-write. Support permissions never open a participation path: acceptance is evaluated as if
the caller were an ordinary member.

`start` sets `expiresAt` from the completion window of the version the participant accepted, not
from the Quest as it stands, so an owner cannot shorten someone's deadline after the fact.
`completion-request` refuses with 409 once that window has passed, and is where Phase 02 stops: the
claim is recorded and `COMPLETION_REQUESTED` is terminal. Evidence, verification and rewards are
later phases, and no XP, badge or ranking is issued anywhere in this API. Both `start` and `completion-request` also refuse with 409 while the Quest's **owner** is no longer
eligible, carrying the same `This Quest is no longer available` an unpublished Quest produces — word
for word, so a participant cannot tell a withdrawn Quest from a suspended author. `cancel` works from
`ACCEPTED` or `STARTED`, and deliberately still works when the Quest is no longer published or its
owner is no longer eligible — a participant must always be able to let go of an attempt, and must
never be trapped in one they can neither finish nor close by somebody else's suspension. Attempts whose window elapses become
`EXPIRED` through an idempotent sweep run by `pnpm --filter @quest/api quests:process-expiries`
— a scheduled worker replaces the command once a deployment exists. There is no HTTP route for it.

Another account's participation id is a 404, never a 403.

## Optimistic concurrency

Three fields exist so that a client working from a stale read cannot overwrite, publish or accept
something it never saw.

- `expectedRevision` on `PUT /v1/quests/:questId` — the `revision` the client last read. A
  concurrent edit, or a publish in between, makes the update a 409 instead of a silent overwrite.
- `expectedContentHash` on publish — the hash the owner believes they are approving. It closes the
  publish-while-editing race: content edited in another session cannot be published by accident.
- `expectedPublishedVersion` on accept — optional. A client that read the Quest and wants to be sure
  it is accepting _that_ version sends it and gets a 409 if the owner republished meanwhile; a
  client that does not care omits it and accepts whatever is published now.

On any of these 409s the client should re-read the resource and present the fresh state before
retrying — never retry the same body. The API's own message says as much ("reload and try again"),
but clients should localise by code, not by prose. A publish 409 is different in kind: it is not a
race but a list of things to fix, and the client should render `issues[]` rather than retry.

## Idempotency

`PUT /v1/quests/:questId` is idempotent by definition. `POST /v1/quests` is not: a retry after
success creates a second draft, so clients that retry must carry an `idempotency-key`. `publish`,
`archive`, `suspend` and `reinstate` are state transitions guarded by the lifecycle machine — a
repeat is a 409, not a duplicate. Accepting twice is a 409. `assessment` is deliberately not
idempotent: each call records a new decision that supersedes the previous one, which is what makes
the ledger auditable.
