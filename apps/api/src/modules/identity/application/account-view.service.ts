import { Inject, Injectable } from '@nestjs/common';
import { type AccountView, INTERESTS_MIN_FOR_ONBOARDING } from '@quest/types';

import type { Executor } from '../../../infrastructure/database/executor';
import { PROFILE_QUERY, type ProfileQueryPort } from '../../profiles';
import { type AccountRecord, onboardingNextStep, toAccountView } from '../domain/account';
import { AccountRepository } from '../infrastructure/account.repository';
import { LifecycleRepository } from '../infrastructure/lifecycle.repository';

/** Builds the client-facing AccountView (GET /v1/me and every auth response). */
@Injectable()
export class AccountViewService {
  constructor(
    @Inject(PROFILE_QUERY) private readonly profiles: ProfileQueryPort,
    private readonly accounts: AccountRepository,
    private readonly lifecycle: LifecycleRepository,
  ) {}

  async view(account: AccountRecord, tx?: Executor): Promise<AccountView> {
    const [roles, facts, deletion, credential, identities] = await Promise.all([
      this.accounts.activeRoles(account.id, tx),
      this.profiles.onboardingFacts(account.id, tx),
      this.lifecycle.pendingDeletion(account.id, tx),
      this.accounts.getCredential(account.id, tx),
      this.accounts.listIdentities(account.id, tx),
    ]);
    const nextStep = onboardingNextStep({
      emailVerified: account.emailVerifiedAt !== null,
      hasUsername: facts.hasUsername,
      hasDisplayName: facts.hasDisplayName,
      interestCount: facts.interestCount,
      minInterests: INTERESTS_MIN_FOR_ONBOARDING,
    });
    return toAccountView(
      account,
      roles,
      {
        hasPassword: credential !== undefined,
        linkedProviders: identities.map(
          (i) => i.provider as AccountView['linkedProviders'][number],
        ),
      },
      { completed: facts.onboardingCompletedAt !== null, nextStep },
      deletion?.scheduledFor ?? null,
    );
  }
}
