import { z } from 'zod';

/**
 * Quest lifecycle and participation state machines (Phase 02).
 *
 * A Quest is a governed executable challenge, not a post: it can only become visible to other
 * people through an explicit, auditable transition that the safety gate authorises. Both machines
 * below are the single source of truth — services must route every state change through
 * `nextQuestState` / `nextParticipationState` rather than assigning a state directly.
 */

export const QuestState = {
  /** Owner is still editing. Never visible to anyone else. */
  DRAFT: 'DRAFT',
  /** A safety assessment asked for human review. Not visible; the owner may edit back to DRAFT. */
  IN_REVIEW: 'IN_REVIEW',
  /** Visible according to `visibility`, bound to the assessment and content hash it published with. */
  PUBLISHED: 'PUBLISHED',
  /** Retired by the owner. Existing participations keep working; no new ones. */
  ARCHIVED: 'ARCHIVED',
  /** Withdrawn by Trust & Safety staff. Not visible; only staff can reinstate (to DRAFT). */
  SUSPENDED: 'SUSPENDED',
  /** Content erased (owner account deletion). Terminal, kept only for referential integrity. */
  ERASED: 'ERASED',
} as const;
export type QuestState = (typeof QuestState)[keyof typeof QuestState];
export const questStateSchema = z.enum(Object.values(QuestState) as [QuestState, ...QuestState[]]);

export const QuestTransition = {
  /** Owner asked for an assessment and it requires human review. */
  REQUIRE_REVIEW: 'REQUIRE_REVIEW',
  /** Owner edited safety-relevant content: any approval is void and the Quest leaves visibility. */
  REVISE: 'REVISE',
  /** The publish gate authorised publication (see `canPublishWithAssessment`). */
  PUBLISH: 'PUBLISH',
  ARCHIVE: 'ARCHIVE',
  SUSPEND: 'SUSPEND',
  /** Staff reinstatement never restores visibility directly: the Quest must be published again. */
  REINSTATE: 'REINSTATE',
  ERASE: 'ERASE',
} as const;
export type QuestTransition = (typeof QuestTransition)[keyof typeof QuestTransition];

const S = QuestState;
const T = QuestTransition;

/** from-state → transition → to-state. Absent entries are forbidden. */
export const QUEST_TRANSITIONS: Readonly<
  Record<QuestState, Readonly<Partial<Record<QuestTransition, QuestState>>>>
> = {
  DRAFT: {
    [T.REQUIRE_REVIEW]: S.IN_REVIEW,
    [T.PUBLISH]: S.PUBLISHED,
    [T.ARCHIVE]: S.ARCHIVED,
    [T.SUSPEND]: S.SUSPENDED,
    [T.ERASE]: S.ERASED,
    // A DRAFT edit keeps it a DRAFT; REVISE is still accepted so callers have one code path.
    [T.REVISE]: S.DRAFT,
  },
  IN_REVIEW: {
    [T.REVISE]: S.DRAFT,
    // No PUBLISH: a Quest in review can only reach PUBLISHED by being revised and re-assessed.
    [T.ARCHIVE]: S.ARCHIVED,
    [T.SUSPEND]: S.SUSPENDED,
    [T.ERASE]: S.ERASED,
  },
  PUBLISHED: {
    /** Editing safety-relevant content unpublishes: the previous approval is stale by definition. */
    [T.REVISE]: S.DRAFT,
    [T.REQUIRE_REVIEW]: S.IN_REVIEW,
    [T.ARCHIVE]: S.ARCHIVED,
    [T.SUSPEND]: S.SUSPENDED,
    [T.ERASE]: S.ERASED,
  },
  ARCHIVED: {
    [T.SUSPEND]: S.SUSPENDED,
    [T.ERASE]: S.ERASED,
  },
  SUSPENDED: {
    [T.REINSTATE]: S.DRAFT,
    [T.ERASE]: S.ERASED,
  },
  ERASED: {},
};

export function nextQuestState(
  from: QuestState,
  transition: QuestTransition,
): QuestState | undefined {
  return QUEST_TRANSITIONS[from][transition];
}

export function canTransitionQuest(from: QuestState, transition: QuestTransition): boolean {
  return nextQuestState(from, transition) !== undefined;
}

/** States in which a Quest may be visible to somebody other than its owner and staff. */
export const QUEST_VISIBLE_STATES: ReadonlySet<QuestState> = new Set([S.PUBLISHED]);

/** States in which the owner may still edit content. */
export const QUEST_EDITABLE_STATES: ReadonlySet<QuestState> = new Set([
  S.DRAFT,
  S.IN_REVIEW,
  S.PUBLISHED,
]);

// --------------------------------------------------------------------------- participation ----

export const ParticipationState = {
  /** The participant committed to the Quest; the accepted Quest version is frozen on the record. */
  ACCEPTED: 'ACCEPTED',
  /** Attempt in progress; the completion window (if any) runs from `startedAt`. */
  STARTED: 'STARTED',
  /** The participant declares completion; evidence verification arrives in a later phase. */
  COMPLETION_REQUESTED: 'COMPLETION_REQUESTED',
  CANCELLED: 'CANCELLED',
  /** The completion window elapsed without a completion request. */
  EXPIRED: 'EXPIRED',
} as const;
export type ParticipationState = (typeof ParticipationState)[keyof typeof ParticipationState];
export const participationStateSchema = z.enum(
  Object.values(ParticipationState) as [ParticipationState, ...ParticipationState[]],
);

export const ParticipationTransition = {
  START: 'START',
  REQUEST_COMPLETION: 'REQUEST_COMPLETION',
  CANCEL: 'CANCEL',
  EXPIRE: 'EXPIRE',
} as const;
export type ParticipationTransition =
  (typeof ParticipationTransition)[keyof typeof ParticipationTransition];

const PS = ParticipationState;
const PT = ParticipationTransition;

export const PARTICIPATION_TRANSITIONS: Readonly<
  Record<ParticipationState, Readonly<Partial<Record<ParticipationTransition, ParticipationState>>>>
> = {
  ACCEPTED: {
    [PT.START]: PS.STARTED,
    [PT.CANCEL]: PS.CANCELLED,
    [PT.EXPIRE]: PS.EXPIRED,
  },
  STARTED: {
    [PT.REQUEST_COMPLETION]: PS.COMPLETION_REQUESTED,
    [PT.CANCEL]: PS.CANCELLED,
    [PT.EXPIRE]: PS.EXPIRED,
  },
  // Terminal: Phase 02 stops at "proof required". Verification and rewards are later phases.
  COMPLETION_REQUESTED: {},
  CANCELLED: {},
  EXPIRED: {},
};

export function nextParticipationState(
  from: ParticipationState,
  transition: ParticipationTransition,
): ParticipationState | undefined {
  return PARTICIPATION_TRANSITIONS[from][transition];
}

export function canTransitionParticipation(
  from: ParticipationState,
  transition: ParticipationTransition,
): boolean {
  return nextParticipationState(from, transition) !== undefined;
}

/** States that occupy the single active participation slot per (quest, account). */
export const PARTICIPATION_ACTIVE_STATES: ReadonlySet<ParticipationState> = new Set([
  PS.ACCEPTED,
  PS.STARTED,
]);
