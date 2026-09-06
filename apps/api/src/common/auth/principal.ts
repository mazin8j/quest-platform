import type { AccountState, AgeBand, Role } from '@quest/types';

/**
 * The authenticated caller as seen by guards and controllers. Resolved from a bearer token by the
 * Identity context (PRINCIPAL_RESOLVER); cross-cutting code depends on this shape only.
 * Never carries email, names or the date of birth.
 */
export interface Principal {
  /** Immutable account id (the `sub` claim). */
  accountId: string;
  sessionId: string;
  roles: ReadonlyArray<Role>;
  state: AccountState;
  emailVerified: boolean;
  /** Coarse age band derived by Identity; drives elevated controls without exposing the DOB. */
  ageBand: AgeBand;
}

export interface PrincipalResolver {
  /**
   * Returns the principal for a bearer token, or null when the token is invalid, expired, or its
   * session has been revoked. Must never throw for a bad token (guards turn null into 401).
   */
  resolve(bearerToken: string): Promise<Principal | null>;
}

export const PRINCIPAL_RESOLVER = Symbol('PRINCIPAL_RESOLVER');

/** Attached to the Express request by the AuthGuard. */
export const REQUEST_PRINCIPAL_KEY = 'questPrincipal';
