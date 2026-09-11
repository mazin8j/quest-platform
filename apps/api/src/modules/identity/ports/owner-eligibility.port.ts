import { AccountState } from '@quest/types';

/**
 * The read port other contexts use to ask one question: may this account's content be public?
 *
 * It exists because account lifecycle is Identity's to interpret, not the Quest context's. Quest
 * Core knows that an ineligible owner's Quests must be concealed; it does not know — and must not
 * encode — which lifecycle states mean that (audit P02-41 / TD-48, ADR-014).
 *
 * Deliberately narrower than `AccountFactsPort`: that one answers "what state is this account in",
 * which invites a caller to write its own policy over the answer. This one answers the policy
 * question itself, so the rule lives in exactly one place.
 *
 * The batch method is not an optimisation afterthought. Discovery reads a page of Quests owned by
 * many different accounts, and one lookup per row would make every feed request an N+1. Callers
 * that handle more than one Quest must use `eligibilityForMany`.
 */
export interface OwnerEligibilityPort {
  /** Whether this account's published content may currently be public. */
  isPublicationEligible(accountId: string): Promise<boolean>;

  /**
   * The same question for many accounts in one query, keyed by account id. An account id that
   * does not resolve is absent from the map, and callers must read absence as *ineligible*.
   */
  publicationEligibilityFor(accountIds: readonly string[]): Promise<Map<string, boolean>>;
}

export const OWNER_ELIGIBILITY = Symbol('OWNER_ELIGIBILITY');

/**
 * The policy, in one place.
 *
 * Only `ACTIVE` accounts may have public content. Everything else is concealed:
 *
 * - `PENDING_VERIFICATION` — never reaches publication anyway (`evaluatePublish` requires ACTIVE),
 *   listed for completeness;
 * - `SUSPENDED` — a staff sanction on the author has to take their content down with them, which
 *   is the whole point of suspending them;
 * - `DEACTIVATED` — the user asked to be invisible; leaving their Quests public would make that a
 *   half-measure they did not agree to;
 * - `DELETION_REQUESTED` — fail closed. The account is on its way out, and the grace period exists
 *   so the *user* can change their mind, not so their content stays publicly actionable while they
 *   decide. Reactivation restores visibility if the Quest's own proof is still valid;
 * - `DELETED` — the erasure cascade already drives their Quests to ERASED; this is the backstop
 *   for the window before the cascade runs.
 *
 * An unknown state is ineligible, so adding a lifecycle state to Identity fails closed here until
 * somebody decides otherwise.
 */
const PUBLICATION_ELIGIBLE_STATES: ReadonlySet<string> = new Set([AccountState.ACTIVE]);

export function isPublicationEligibleState(state: string): boolean {
  return PUBLICATION_ELIGIBLE_STATES.has(state);
}
