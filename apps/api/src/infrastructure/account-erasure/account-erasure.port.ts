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
}

export interface AccountErasureRegistryPort {
  register(contributor: AccountErasureContributor): void;
  contributors(): ReadonlyArray<AccountErasureContributor>;
}

export const ACCOUNT_ERASURE_REGISTRY = Symbol('ACCOUNT_ERASURE_REGISTRY');
