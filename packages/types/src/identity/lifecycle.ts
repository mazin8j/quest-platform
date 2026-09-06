import { z } from 'zod';

/**
 * Account lifecycle states (Identity context). The state machine below is the single source of
 * truth for allowed transitions; the API refuses anything else with CONFLICT.
 *
 *   PENDING_VERIFICATION ──verify email──▶ ACTIVE ◀──reactivate── DEACTIVATED
 *            │                              │  ▲                        ▲
 *            │                     deactivate  │ reinstate              │
 *            │                              ▼  │                        │
 *            │                           SUSPENDED (staff)              │
 *            │                              │                           │
 *            └──────── request deletion ────┴──────────────────────────▶ DELETION_REQUESTED
 *                                                                    ▲     │      │
 *                                        SUSPENDED ──resume deletion─┘     │      │ grace elapsed
 *                                            ▲  (staff)                    │      ▼
 *                                            └──── suspend ────────────────┘   DELETED (terminal)
 *   cancel (grace) restores the state the request was made from (previous_state).
 */
export const AccountState = {
  PENDING_VERIFICATION: 'PENDING_VERIFICATION',
  ACTIVE: 'ACTIVE',
  DEACTIVATED: 'DEACTIVATED',
  SUSPENDED: 'SUSPENDED',
  DELETION_REQUESTED: 'DELETION_REQUESTED',
  DELETED: 'DELETED',
} as const;
export type AccountState = (typeof AccountState)[keyof typeof AccountState];
export const accountStateSchema = z.enum(
  Object.values(AccountState) as [AccountState, ...AccountState[]],
);

export const AccountTransition = {
  VERIFY_EMAIL: 'VERIFY_EMAIL',
  DEACTIVATE: 'DEACTIVATE',
  REACTIVATE: 'REACTIVATE',
  SUSPEND: 'SUSPEND',
  REINSTATE: 'REINSTATE',
  REQUEST_DELETION: 'REQUEST_DELETION',
  CANCEL_DELETION: 'CANCEL_DELETION',
  COMPLETE_DELETION: 'COMPLETE_DELETION',
  /** Staff reinstated an account that still has a pending deletion request. */
  RESUME_DELETION: 'RESUME_DELETION',
} as const;
export type AccountTransition = (typeof AccountTransition)[keyof typeof AccountTransition];

const S = AccountState;
const T = AccountTransition;

/** from-state → transition → to-state. Absent entries are forbidden. */
export const ACCOUNT_TRANSITIONS: Readonly<
  Record<AccountState, Readonly<Partial<Record<AccountTransition, AccountState>>>>
> = {
  PENDING_VERIFICATION: {
    [T.VERIFY_EMAIL]: S.ACTIVE,
    [T.SUSPEND]: S.SUSPENDED,
    [T.REQUEST_DELETION]: S.DELETION_REQUESTED,
  },
  ACTIVE: {
    [T.DEACTIVATE]: S.DEACTIVATED,
    [T.SUSPEND]: S.SUSPENDED,
    [T.REQUEST_DELETION]: S.DELETION_REQUESTED,
  },
  DEACTIVATED: {
    [T.REACTIVATE]: S.ACTIVE,
    [T.SUSPEND]: S.SUSPENDED,
    [T.REQUEST_DELETION]: S.DELETION_REQUESTED,
  },
  SUSPENDED: {
    [T.REINSTATE]: S.ACTIVE,
    [T.RESUME_DELETION]: S.DELETION_REQUESTED,
    // A suspended user may still exercise the right to erasure; staff review the request.
    [T.REQUEST_DELETION]: S.DELETION_REQUESTED,
  },
  DELETION_REQUESTED: {
    // CANCEL_DELETION targets ACTIVE only when the request was made from ACTIVE; the service
    // restores the recorded previous state (PENDING_VERIFICATION / SUSPENDED) otherwise.
    [T.CANCEL_DELETION]: S.ACTIVE,
    [T.COMPLETE_DELETION]: S.DELETED,
    // Trust & Safety keeps its power during the grace period; the pending request is paused.
    [T.SUSPEND]: S.SUSPENDED,
  },
  DELETED: {},
};

export function nextAccountState(
  from: AccountState,
  transition: AccountTransition,
): AccountState | undefined {
  return ACCOUNT_TRANSITIONS[from][transition];
}

export function canTransitionAccount(from: AccountState, transition: AccountTransition): boolean {
  return nextAccountState(from, transition) !== undefined;
}

/** States in which a user may obtain or keep a session. */
export const SIGN_IN_ALLOWED_STATES: ReadonlySet<AccountState> = new Set([
  S.PENDING_VERIFICATION,
  S.ACTIVE,
  // Signing in to a deactivated account reactivates it (documented UX). Deletion-requested users
  // may sign in only to cancel the request; everything else is blocked by the lifecycle guard.
  S.DEACTIVATED,
  S.DELETION_REQUESTED,
]);

/** States in which the account may use ordinary product features. */
export const FULLY_USABLE_STATES: ReadonlySet<AccountState> = new Set([S.ACTIVE]);
