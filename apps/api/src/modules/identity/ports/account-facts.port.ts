/**
 * The read port other contexts use to learn the two account facts they are allowed to know:
 * whether the account is usable, and whether its address is verified.
 *
 * Identity owns it so no other context ever reads `account` directly, and so the shape of what
 * leaves this context is decided here: no email, no date of birth, no session, no roles.
 */
export interface AccountFacts {
  accountId: string;
  /** Lifecycle state (`ACTIVE`, `SUSPENDED`, …) as the Identity state machine defines it. */
  state: string;
  emailVerified: boolean;
}

export interface AccountFactsPort {
  /** Facts for an account. Throws NOT FOUND when the account does not exist. */
  factsFor(accountId: string): Promise<AccountFacts>;
}

export const ACCOUNT_FACTS = Symbol('ACCOUNT_FACTS');
