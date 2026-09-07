import type { Executor } from '../database/executor';

/**
 * Account-erasure contract (GDPR Art. 17 / CCPA deletion).
 *
 * Every bounded context that stores account-linked rows registers a contributor. The Identity
 * deletion cascade calls each one *inside the same transaction* that anonymises the account, so
 * erasure is all-or-nothing: a context that fails to erase rolls the whole cascade back rather
 * than leaving orphaned personal data behind a "deleted" account.
 *
 * `identity.account.deleted` is still published afterwards, but it is a notification, not the
 * erasure mechanism — an event handler that never runs must not be able to strand user data.
 *
 * A contributor returns the object-storage keys it wants removed. They are deleted after the
 * transaction commits (a rollback must not erase objects a live account still owns).
 */
export interface AccountErasureContributor {
  readonly context: string;
  eraseAccountData(accountId: string, tx: Executor): Promise<string[]>;
  /**
   * Optional: publish whatever the erasure should announce, called only after the cascade has
   * committed. Events describing erased state must never escape a transaction that rolled back.
   */
  afterCommit?(accountId: string): Promise<void>;
}

export interface AccountErasureRegistryPort {
  register(contributor: AccountErasureContributor): void;
  contributors(): ReadonlyArray<AccountErasureContributor>;
}

/**
 * Contexts that MUST have registered a contributor before any account is erased. Registration is
 * a module side effect, so a reduced module graph (a worker image, a trimmed test module) could
 * otherwise complete a deletion leaving a whole context's personal data untouched and still report
 * success (audit P02-25). The cascade asserts this list instead.
 */
export const REQUIRED_ERASURE_CONTEXTS: ReadonlyArray<string> = ['quest'];

export const ACCOUNT_ERASURE_REGISTRY = Symbol('ACCOUNT_ERASURE_REGISTRY');
