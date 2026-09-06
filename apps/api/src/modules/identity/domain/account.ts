import {
  type AccountState,
  type AccountTransition,
  type AccountView,
  type AgeBand,
  type OnboardingStep,
  type Role,
  deriveAgeBand,
  nextAccountState,
} from '@quest/types';

import { ApiError } from '../../../common/filters/api-error';

/** Persistence shape of an account (subset the domain reasons about). */
export interface AccountRecord {
  id: string;
  email: string | null;
  emailVerifiedAt: Date | null;
  state: AccountState;
  dateOfBirth: string;
  lastLoginAt: Date | null;
  deactivatedAt: Date | null;
  suspendedAt: Date | null;
  suspensionReason: string | null;
  deletedAt: Date | null;
  createdAt: Date;
}

export type LiveAgeBand = Exclude<AgeBand, 'UNDER_MINIMUM'>;

export function accountAgeBand(
  account: Pick<AccountRecord, 'dateOfBirth'>,
  at = new Date(),
): LiveAgeBand {
  const band = deriveAgeBand(account.dateOfBirth, at);
  // A stored DOB always passed the minimum-age check at registration; guard anyway.
  return band === 'UNDER_MINIMUM' ? 'TEEN_13_15' : band;
}

/** Applies a lifecycle transition or throws CONFLICT — the only way state changes. */
export function transitionAccount(from: AccountState, transition: AccountTransition): AccountState {
  const to = nextAccountState(from, transition);
  if (!to) {
    throw ApiError.conflict(
      `Account cannot ${transition.toLowerCase().replace('_', ' ')} from state ${from}`,
    );
  }
  return to;
}

export interface OnboardingFacts {
  emailVerified: boolean;
  hasUsername: boolean;
  hasDisplayName: boolean;
  interestCount: number;
  minInterests: number;
}

export function onboardingMissing(
  f: OnboardingFacts,
): Array<'EMAIL_VERIFIED' | 'USERNAME' | 'DISPLAY_NAME' | 'INTERESTS'> {
  const missing: Array<'EMAIL_VERIFIED' | 'USERNAME' | 'DISPLAY_NAME' | 'INTERESTS'> = [];
  if (!f.emailVerified) missing.push('EMAIL_VERIFIED');
  if (!f.hasUsername) missing.push('USERNAME');
  if (!f.hasDisplayName) missing.push('DISPLAY_NAME');
  if (f.interestCount < f.minInterests) missing.push('INTERESTS');
  return missing;
}

export function onboardingNextStep(f: OnboardingFacts): OnboardingStep {
  if (!f.emailVerified) return 'VERIFY_EMAIL';
  if (!f.hasUsername || !f.hasDisplayName) return 'PROFILE';
  if (f.interestCount < f.minInterests) return 'INTERESTS';
  return 'DONE';
}

export function toAccountView(
  account: AccountRecord,
  roles: ReadonlyArray<Role>,
  auth: { hasPassword: boolean; linkedProviders: AccountView['linkedProviders'] },
  onboarding: { completed: boolean; nextStep: OnboardingStep },
  deletionScheduledFor: Date | null,
): AccountView {
  return {
    accountId: account.id,
    email: account.email ?? '',
    emailVerified: account.emailVerifiedAt !== null,
    state: account.state,
    ageBand: accountAgeBand(account),
    roles: ['USER', ...roles.filter((r) => r !== 'USER')],
    hasPassword: auth.hasPassword,
    linkedProviders: auth.linkedProviders,
    onboarding,
    createdAt: account.createdAt.toISOString(),
    deletionScheduledFor: deletionScheduledFor?.toISOString() ?? null,
  };
}
