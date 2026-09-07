import type { AgeBand } from '@quest/types';

import type { Executor } from '../../../infrastructure/database/executor';

/**
 * Port used by the Identity context (upstream) to keep the profile aggregate consistent with the
 * account lifecycle, inside the same transaction. Profiles never calls Identity back.
 */
export interface ProfileProvisioningPort {
  /** Creates the profile + privacy-settings rows for a new account (age-band defaults). */
  provisionForAccount(
    input: { accountId: string; ageBand: AgeBand; language: string | null; country: string | null },
    tx?: Executor,
  ): Promise<void>;
  /** Mirrors account state: only active accounts are visible to other users. */
  setAccountActive(accountId: string, active: boolean, tx?: Executor): Promise<void>;
  /**
   * Irreversibly erases profile data (deletion cascade). Idempotent. Returns the object-storage
   * keys the caller must delete **after the transaction commits** — the port never deletes objects
   * itself, so a rollback cannot destroy a live account's media (audit P01-02).
   */
  eraseAccount(accountId: string, tx?: Executor): Promise<string[]>;
}
export const PROFILE_PROVISIONER = Symbol('PROFILE_PROVISIONER');

/** Read-side port for other contexts (Identity's onboarding status, Quest owner cards). */
export interface ProfileQueryPort {
  onboardingFacts(
    accountId: string,
    tx?: Executor,
  ): Promise<{
    hasUsername: boolean;
    hasDisplayName: boolean;
    interestCount: number;
    onboardingCompletedAt: Date | null;
    username: string | null;
  }>;
  /**
   * Public owner cards for a set of accounts, keyed by account id. Profiles decides what may be
   * shown: an inactive, erased or otherwise non-public profile yields nulls rather than data, and
   * nothing here ever carries an email, a date of birth or a location.
   */
  publicCardsFor(
    accountIds: ReadonlyArray<string>,
    tx?: Executor,
  ): Promise<Record<string, { username: string | null; displayName: string | null }>>;
  /**
   * Coarse country of an account, for server-side eligibility checks only (never returned to a
   * client by the calling context).
   */
  countryFor(accountId: string, tx?: Executor): Promise<string | null>;
}
export const PROFILE_QUERY = Symbol('PROFILE_QUERY');

/**
 * Block precedence for every other context (social graph, feed, notifications — later phases):
 * if either side blocked the other, they must not see, contact or be recommended to each other.
 */
export interface BlockQueryPort {
  isBlockedEitherWay(accountA: string, accountB: string): Promise<boolean>;
}
export const BLOCK_QUERY = Symbol('BLOCK_QUERY');
