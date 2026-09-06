import { Inject, Injectable } from '@nestjs/common';
import { AccountRegistered, createEvent, type EventPublisher } from '@quest/events';
import {
  AccountState,
  type AuthResponse,
  type IdentityProvider,
  type ProviderRegisterRequest,
  type RegisterRequest,
  type RegistrationConsents,
  deriveAgeBand,
} from '@quest/types';

import { getRequestContext } from '../../../common/context/request-context';
import { ApiError } from '../../../common/filters/api-error';
import { uuidv7 } from '../../../common/ids/uuid-v7';
import { METRICS, type MetricsPort } from '../../../common/observability/metrics.port';
import { APP_CONFIG, type AppConfig } from '../../../config/app-config';
import { DATABASE, type Database } from '../../../infrastructure/database/database.module';
import type { Executor } from '../../../infrastructure/database/executor';
import { EVENT_PUBLISHER } from '../../../infrastructure/events/events.module';
import { PROFILE_PROVISIONER, type ProfileProvisioningPort } from '../../profiles';
import { type AccountRecord, accountAgeBand } from '../domain/account';
import { AccountRepository } from '../infrastructure/account.repository';
import { LifecycleRepository } from '../infrastructure/lifecycle.repository';
import { IDENTITY_PROVIDERS, type IdentityProviderRegistry } from '../ports/identity-provider.port';
import { PASSWORD_HASHER, type PasswordHasherPort } from '../ports/password-hasher.port';
import { AccountViewService } from './account-view.service';
import { SessionService } from './session.service';
import { VerificationService } from './verification.service';

const SOURCE = 'api.identity';

/**
 * Account creation (password or external identity). One transaction creates the account,
 * credential/identity link, consent ledger entries, profile + privacy defaults (via the Profiles
 * provisioning port) and the first session; the verification code is sent after commit.
 */
@Injectable()
export class RegistrationService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(EVENT_PUBLISHER) private readonly events: EventPublisher,
    @Inject(METRICS) private readonly metrics: MetricsPort,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasherPort,
    @Inject(IDENTITY_PROVIDERS) private readonly providers: IdentityProviderRegistry,
    @Inject(PROFILE_PROVISIONER) private readonly profiles: ProfileProvisioningPort,
    private readonly accounts: AccountRepository,
    private readonly lifecycle: LifecycleRepository,
    private readonly sessions: SessionService,
    private readonly verification: VerificationService,
    private readonly views: AccountViewService,
  ) {}

  async registerWithPassword(input: RegisterRequest): Promise<AuthResponse> {
    this.assertAgeAndConsents(input.dateOfBirth, input.consents);
    // Hash outside the transaction (CPU-bound) and before the uniqueness check so timing does not
    // reveal whether the email exists.
    const passwordHash = await this.hasher.hash(input.password);

    const result = await this.db.transaction(async (tx) => {
      if (await this.accounts.findLiveByEmail(input.email, tx)) {
        throw ApiError.conflict('An account with this email already exists');
      }
      const account = await this.createAccount(
        {
          email: input.email,
          emailVerifiedAt: null,
          dateOfBirth: input.dateOfBirth,
          language: input.language ?? null,
          country: input.country ?? null,
        },
        input.consents,
        tx,
      );
      await this.accounts.upsertCredential(account.id, passwordHash, tx);
      const tokens = await this.sessions.issueSession(account, [], input.client, tx);
      await this.lifecycle.audit(
        { accountId: account.id, eventType: 'REGISTERED', metadata: { method: 'PASSWORD' } },
        tx,
      );
      return { account, tokens };
    });

    await this.afterRegistration(
      result.account,
      'PASSWORD',
      input.language ?? null,
      input.country ?? null,
    );
    return { account: await this.views.view(result.account), tokens: result.tokens };
  }

  async registerWithProvider(input: ProviderRegisterRequest): Promise<AuthResponse> {
    this.assertAgeAndConsents(input.dateOfBirth, input.consents);
    const adapter = this.providers.get(input.provider);
    if (!adapter)
      throw ApiError.validation([{ path: 'provider', message: 'Provider not enabled' }]);
    const identity = await adapter.verifyIdToken(input.idToken);
    if (!identity) throw ApiError.unauthenticated('Identity token is invalid');
    if (!identity.email || !identity.emailVerified) {
      // Without a verified email from the provider the account has no contact channel.
      throw ApiError.validation([
        { path: 'idToken', message: 'Provider did not supply a verified email' },
      ]);
    }
    const email = identity.email;

    const result = await this.db.transaction(async (tx) => {
      if (await this.accounts.findIdentity(identity.provider, identity.subject, tx)) {
        throw ApiError.conflict('This identity is already linked to an account');
      }
      if (await this.accounts.findLiveByEmail(email, tx)) {
        throw ApiError.conflict('An account with this email already exists');
      }
      const account = await this.createAccount(
        {
          email,
          emailVerifiedAt: new Date(),
          dateOfBirth: input.dateOfBirth,
          language: input.language ?? null,
          country: input.country ?? null,
        },
        input.consents,
        tx,
      );
      await this.accounts.linkIdentity(
        { accountId: account.id, provider: identity.provider, subject: identity.subject, email },
        tx,
      );
      const tokens = await this.sessions.issueSession(account, [], input.client, tx);
      await this.lifecycle.audit(
        { accountId: account.id, eventType: 'REGISTERED', metadata: { method: identity.provider } },
        tx,
      );
      return { account, tokens };
    });

    await this.afterRegistration(
      result.account,
      identity.provider,
      input.language ?? null,
      input.country ?? null,
    );
    return { account: await this.views.view(result.account), tokens: result.tokens };
  }

  // ---------------------------------------------------------------------------- helpers ----

  private assertAgeAndConsents(dateOfBirth: string, consents: RegistrationConsents): void {
    if (deriveAgeBand(dateOfBirth) === 'UNDER_MINIMUM') {
      // Deliberately generic: do not confirm the exact threshold to a possible under-age user.
      throw ApiError.forbidden('You are not eligible to create an account');
    }
    if (consents.termsOfServiceVersion !== this.config.AUTH_TERMS_VERSION) {
      throw ApiError.validation([
        {
          path: 'consents.termsOfServiceVersion',
          message: `Current version is ${this.config.AUTH_TERMS_VERSION}`,
        },
      ]);
    }
    if (consents.privacyPolicyVersion !== this.config.AUTH_PRIVACY_POLICY_VERSION) {
      throw ApiError.validation([
        {
          path: 'consents.privacyPolicyVersion',
          message: `Current version is ${this.config.AUTH_PRIVACY_POLICY_VERSION}`,
        },
      ]);
    }
  }

  private async createAccount(
    input: {
      email: string;
      emailVerifiedAt: Date | null;
      dateOfBirth: string;
      language: string | null;
      country: string | null;
    },
    consents: RegistrationConsents,
    tx: Executor,
  ): Promise<AccountRecord> {
    const account = await this.accounts.insert(
      {
        id: uuidv7(),
        email: input.email,
        emailVerifiedAt: input.emailVerifiedAt,
        state: input.emailVerifiedAt ? AccountState.ACTIVE : AccountState.PENDING_VERIFICATION,
        dateOfBirth: input.dateOfBirth,
      },
      tx,
    );
    await this.accounts.appendConsents(
      account.id,
      [
        {
          type: 'TERMS_OF_SERVICE',
          documentVersion: consents.termsOfServiceVersion,
          granted: true,
          source: 'REGISTRATION',
        },
        {
          type: 'PRIVACY_POLICY',
          documentVersion: consents.privacyPolicyVersion,
          granted: true,
          source: 'REGISTRATION',
        },
        { type: 'AGE_ATTESTATION', documentVersion: null, granted: true, source: 'REGISTRATION' },
        {
          type: 'ANALYTICS',
          documentVersion: null,
          granted: consents.analytics,
          source: 'REGISTRATION',
        },
        {
          type: 'PERSONALISATION',
          documentVersion: null,
          granted: consents.personalisation,
          source: 'REGISTRATION',
        },
        {
          type: 'MARKETING',
          documentVersion: null,
          granted: consents.marketing,
          source: 'REGISTRATION',
        },
      ],
      tx,
    );
    await this.profiles.provisionForAccount(
      {
        accountId: account.id,
        ageBand: accountAgeBand(account),
        language: input.language,
        country: input.country,
      },
      tx,
    );
    if (account.state === AccountState.ACTIVE)
      await this.profiles.setAccountActive(account.id, true, tx);
    return account;
  }

  private async afterRegistration(
    account: AccountRecord,
    method: IdentityProvider | 'PASSWORD',
    language: string | null,
    country: string | null,
  ): Promise<void> {
    this.metrics.increment('quest.identity.registered', 1, { method });
    if (!account.emailVerifiedAt && account.email) {
      await this.verification.issue(
        {
          accountId: account.id,
          email: account.email,
          language: language ?? 'en',
          purpose: 'VERIFY_EMAIL',
        },
        { enforceCooldown: false },
      );
    }
    await this.events.publish(
      createEvent(
        AccountRegistered,
        { accountId: account.id, method, ageBand: accountAgeBand(account), country, language },
        {
          aggregateId: account.id,
          correlationId: getRequestContext()?.correlationId ?? uuidv7(),
          source: SOURCE,
          actorId: account.id,
        },
      ),
    );
  }
}
