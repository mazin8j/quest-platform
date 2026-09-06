import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import {
  AccountEmailVerified,
  AccountReactivated,
  AccountSessionsRevoked,
  createEvent,
  type EventPublisher,
} from '@quest/events';
import {
  AccountState,
  type AuthResponse,
  type ChangePasswordRequest,
  type ClientContext,
  type LoginRequest,
  type ProviderSignInRequest,
  type ResetPasswordRequest,
  SIGN_IN_ALLOWED_STATES,
  passwordContainsEmailLocalPart,
} from '@quest/types';

import type { Principal } from '../../../common/auth/principal';
import { getRequestContext } from '../../../common/context/request-context';
import { ApiError } from '../../../common/filters/api-error';
import { uuidv7 } from '../../../common/ids/uuid-v7';
import { METRICS, type MetricsPort } from '../../../common/observability/metrics.port';
import { APP_CONFIG, type AppConfig } from '../../../config/app-config';
import { DATABASE, type Database } from '../../../infrastructure/database/database.module';
import { EVENT_PUBLISHER } from '../../../infrastructure/events/events.module';
import { PROFILE_PROVISIONER, type ProfileProvisioningPort } from '../../profiles';
import { type AccountRecord, transitionAccount } from '../domain/account';
import { AccountRepository } from '../infrastructure/account.repository';
import { LifecycleRepository } from '../infrastructure/lifecycle.repository';
import { IDENTITY_PROVIDERS, type IdentityProviderRegistry } from '../ports/identity-provider.port';
import { MAILER, type MailerPort } from '../ports/mailer.port';
import { PASSWORD_HASHER, type PasswordHasherPort } from '../ports/password-hasher.port';
import { AccountViewService } from './account-view.service';
import { SessionService } from './session.service';
import { VerificationService } from './verification.service';

const SOURCE = 'api.identity';
/** One message for every sign-in failure so nothing about the account is disclosed. */
const INVALID_CREDENTIALS = 'Invalid email or password';

@Injectable()
export class AuthenticationService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(EVENT_PUBLISHER) private readonly events: EventPublisher,
    @Inject(METRICS) private readonly metrics: MetricsPort,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasherPort,
    @Inject(IDENTITY_PROVIDERS) private readonly providers: IdentityProviderRegistry,
    @Inject(MAILER) private readonly mailer: MailerPort,
    @Inject(PROFILE_PROVISIONER) private readonly profiles: ProfileProvisioningPort,
    private readonly accounts: AccountRepository,
    private readonly lifecycle: LifecycleRepository,
    private readonly sessions: SessionService,
    private readonly verification: VerificationService,
    private readonly views: AccountViewService,
  ) {
    // Used only to equalise timing for unknown emails (see loginWithPassword).
    this.dummyHash = this.hasher.hash(randomUUID());
  }

  private readonly dummyHash: Promise<string>;

  // ------------------------------------------------------------------------------ sign-in ----

  async loginWithPassword(input: LoginRequest): Promise<AuthResponse> {
    const account = await this.accounts.findLiveByEmail(input.email);
    const credential = account ? await this.accounts.getCredential(account.id) : undefined;
    if (!account || !credential) {
      // Burn comparable time so unknown emails are not distinguishable by latency.
      await this.hasher.verify(await this.dummyHash, input.password);
      await this.lifecycle.audit({
        accountId: null,
        eventType: 'LOGIN_FAILED',
        metadata: { reason: 'unknown' },
      });
      this.metrics.increment('quest.identity.login', 1, { result: 'unknown' });
      throw ApiError.unauthenticated(INVALID_CREDENTIALS);
    }
    if (credential.lockedUntil && credential.lockedUntil.getTime() > Date.now()) {
      await this.lifecycle.audit({ accountId: account.id, eventType: 'LOGIN_LOCKED' });
      this.metrics.increment('quest.identity.login', 1, { result: 'locked' });
      throw ApiError.unauthenticated(INVALID_CREDENTIALS);
    }
    const ok = await this.hasher.verify(credential.passwordHash, input.password);
    if (!ok) {
      const failures = await this.accounts.recordLoginFailure(
        account.id,
        this.config.AUTH_LOGIN_MAX_FAILURES,
        this.config.AUTH_LOGIN_LOCK_MINUTES,
      );
      await this.lifecycle.audit({
        accountId: account.id,
        eventType: 'LOGIN_FAILED',
        metadata: { failures },
      });
      this.metrics.increment('quest.identity.login', 1, { result: 'bad_password' });
      throw ApiError.unauthenticated(INVALID_CREDENTIALS);
    }
    if (this.hasher.needsRehash(credential.passwordHash)) {
      await this.accounts.upsertCredential(account.id, await this.hasher.hash(input.password));
    } else {
      await this.accounts.resetLoginFailures(account.id);
    }
    return this.completeSignIn(account, input.client, 'PASSWORD');
  }

  async loginWithProvider(input: ProviderSignInRequest): Promise<AuthResponse> {
    const adapter = this.providers.get(input.provider);
    if (!adapter)
      throw ApiError.validation([{ path: 'provider', message: 'Provider not enabled' }]);
    const identity = await adapter.verifyIdToken(input.idToken);
    if (!identity) {
      this.metrics.increment('quest.identity.login', 1, {
        result: 'bad_id_token',
        provider: input.provider,
      });
      throw ApiError.unauthenticated('Identity token is invalid');
    }
    const link = await this.accounts.findIdentity(identity.provider, identity.subject);
    const account = link ? await this.accounts.findById(link.accountId) : undefined;
    if (!link || !account || account.deletedAt) {
      // Distinct from a bad token: the client must run the register flow (collect DOB + consents).
      throw ApiError.notFound('Account for this identity');
    }
    await this.accounts.touchIdentity(link.id);
    return this.completeSignIn(account, input.client, identity.provider);
  }

  private async completeSignIn(
    account: AccountRecord,
    client: ClientContext | undefined,
    method: string,
  ): Promise<AuthResponse> {
    if (!SIGN_IN_ALLOWED_STATES.has(account.state)) {
      await this.lifecycle.audit({
        accountId: account.id,
        eventType: 'LOGIN_BLOCKED_STATE',
        metadata: { state: account.state },
      });
      this.metrics.increment('quest.identity.login', 1, { result: 'blocked_state' });
      // Suspended/deleted accounts get the same generic answer as bad credentials.
      throw ApiError.unauthenticated(INVALID_CREDENTIALS);
    }
    const result = await this.db.transaction(async (tx) => {
      let current = account;
      let reactivated = false;
      if (current.state === AccountState.DEACTIVATED) {
        const next = transitionAccount(current.state, 'REACTIVATE');
        await this.accounts.update(current.id, { state: next, deactivatedAt: null }, tx);
        await this.profiles.setAccountActive(current.id, true, tx);
        await this.lifecycle.audit({ accountId: current.id, eventType: 'REACTIVATED' }, tx);
        current = { ...current, state: next, deactivatedAt: null };
        reactivated = true;
      }
      await this.accounts.update(current.id, { lastLoginAt: new Date() }, tx);
      const roles = await this.accounts.activeRoles(current.id, tx);
      const tokens = await this.sessions.issueSession(current, roles, client, tx);
      await this.lifecycle.audit(
        {
          accountId: current.id,
          eventType: 'LOGIN_SUCCEEDED',
          sessionId: tokens.sessionId,
          metadata: { method },
        },
        tx,
      );
      return { account: current, tokens, reactivated };
    });
    this.metrics.increment('quest.identity.login', 1, { result: 'ok', method });
    if (result.reactivated) {
      await this.publish(
        createEvent(AccountReactivated, { accountId: account.id }, this.opts(account.id)),
      );
    }
    return { account: await this.views.view(result.account), tokens: result.tokens };
  }

  // ------------------------------------------------------------------------------ refresh ----

  async refresh(refreshToken: string): Promise<AuthResponse> {
    const { tokens, account } = await this.sessions.refresh(refreshToken);
    return { account: await this.views.view(account), tokens };
  }

  // ----------------------------------------------------------------------------- sign-out ----

  async logout(principal: Principal): Promise<void> {
    await this.sessions.revoke(principal.accountId, principal.sessionId, 'USER_SIGN_OUT');
  }

  async logoutAll(principal: Principal): Promise<number> {
    const n = await this.sessions.revokeAll(principal.accountId, 'USER_SIGN_OUT_ALL');
    await this.publish(
      createEvent(
        AccountSessionsRevoked,
        { accountId: principal.accountId, reason: 'USER_SIGN_OUT_ALL', sessionCount: n },
        this.opts(principal.accountId),
      ),
    );
    return n;
  }

  // ------------------------------------------------------------------- email verification ----

  async verifyEmail(principal: Principal, code: string): Promise<AuthResponse['account']> {
    const account = await this.requireAccount(principal.accountId);
    if (account.emailVerifiedAt) return this.views.view(account);
    const ok = await this.verification.verify(account.id, 'VERIFY_EMAIL', code);
    if (!ok) {
      await this.lifecycle.audit({ accountId: account.id, eventType: 'EMAIL_VERIFY_FAILED' });
      throw ApiError.validation(
        [{ path: 'code', message: 'Code is invalid or expired' }],
        'Verification failed',
      );
    }
    const updated = await this.db.transaction(async (tx) => {
      const next =
        account.state === AccountState.PENDING_VERIFICATION
          ? transitionAccount(account.state, 'VERIFY_EMAIL')
          : account.state;
      await this.accounts.update(account.id, { emailVerifiedAt: new Date(), state: next }, tx);
      if (next === AccountState.ACTIVE) await this.profiles.setAccountActive(account.id, true, tx);
      await this.lifecycle.audit({ accountId: account.id, eventType: 'EMAIL_VERIFIED' }, tx);
      return { ...account, emailVerifiedAt: new Date(), state: next };
    });
    this.metrics.increment('quest.identity.email_verified');
    await this.publish(
      createEvent(AccountEmailVerified, { accountId: account.id }, this.opts(account.id)),
    );
    return this.views.view(updated);
  }

  async resendVerification(principal: Principal): Promise<void> {
    const account = await this.requireAccount(principal.accountId);
    if (account.emailVerifiedAt || !account.email) return;
    await this.verification.issue(
      { accountId: account.id, email: account.email, language: 'en', purpose: 'VERIFY_EMAIL' },
      { enforceCooldown: true },
    );
  }

  // ------------------------------------------------------------------------------ passwords ----

  async changePassword(principal: Principal, input: ChangePasswordRequest): Promise<void> {
    const account = await this.requireAccount(principal.accountId);
    const credential = await this.accounts.getCredential(account.id);
    if (!credential) throw ApiError.conflict('This account signs in with an external identity');
    if (!(await this.hasher.verify(credential.passwordHash, input.currentPassword))) {
      await this.lifecycle.audit({
        accountId: account.id,
        eventType: 'LOGIN_FAILED',
        metadata: { reason: 'change_password' },
      });
      throw ApiError.unauthenticated('Current password is incorrect');
    }
    if (account.email && passwordContainsEmailLocalPart(input.newPassword, account.email)) {
      throw ApiError.validation([
        { path: 'newPassword', message: 'Password must not contain your email address' },
      ]);
    }
    const hash = await this.hasher.hash(input.newPassword);
    const revoked = await this.db.transaction(async (tx) => {
      await this.accounts.upsertCredential(account.id, hash, tx);
      const n = await this.sessions.revokeAll(
        account.id,
        'PASSWORD_CHANGED',
        principal.sessionId,
        tx,
      );
      await this.lifecycle.audit(
        { accountId: account.id, eventType: 'PASSWORD_CHANGED', sessionId: principal.sessionId },
        tx,
      );
      return n;
    });
    this.metrics.increment('quest.identity.password_changed');
    if (account.email) {
      await this.mailer.send({
        to: account.email,
        language: 'en',
        template: { name: 'PASSWORD_CHANGED' },
      });
    }
    await this.publish(
      createEvent(
        AccountSessionsRevoked,
        { accountId: account.id, reason: 'PASSWORD_CHANGED', sessionCount: revoked },
        this.opts(account.id),
      ),
    );
  }

  /** Always succeeds from the caller's point of view (no account enumeration). */
  async forgotPassword(email: string): Promise<void> {
    const account = await this.accounts.findLiveByEmail(email);
    if (!account || !account.email) return;
    const credential = await this.accounts.getCredential(account.id);
    if (!credential) return; // provider-only account: nothing to reset
    if (!SIGN_IN_ALLOWED_STATES.has(account.state)) return;
    try {
      await this.verification.issue(
        { accountId: account.id, email: account.email, language: 'en', purpose: 'RESET_PASSWORD' },
        { enforceCooldown: true },
      );
      await this.lifecycle.audit({ accountId: account.id, eventType: 'PASSWORD_RESET_REQUESTED' });
    } catch (error) {
      // Cooldown conflicts are swallowed on purpose: the response must not reveal them.
      if (!(error instanceof ApiError)) throw error;
    }
  }

  async resetPassword(input: ResetPasswordRequest): Promise<void> {
    const account = await this.accounts.findLiveByEmail(input.email);
    const generic = () =>
      ApiError.validation(
        [{ path: 'code', message: 'Code is invalid or expired' }],
        'Reset failed',
      );
    if (!account || !account.email) throw generic();
    const ok = await this.verification.verify(account.id, 'RESET_PASSWORD', input.code);
    if (!ok) throw generic();
    if (passwordContainsEmailLocalPart(input.newPassword, account.email)) {
      throw ApiError.validation([
        { path: 'newPassword', message: 'Password must not contain your email address' },
      ]);
    }
    const hash = await this.hasher.hash(input.newPassword);
    const revoked = await this.db.transaction(async (tx) => {
      await this.accounts.upsertCredential(account.id, hash, tx);
      const n = await this.sessions.revokeAll(account.id, 'PASSWORD_RESET', undefined, tx);
      await this.lifecycle.audit({ accountId: account.id, eventType: 'PASSWORD_RESET' }, tx);
      return n;
    });
    this.metrics.increment('quest.identity.password_reset');
    await this.mailer.send({
      to: account.email,
      language: 'en',
      template: { name: 'PASSWORD_CHANGED' },
    });
    await this.publish(
      createEvent(
        AccountSessionsRevoked,
        { accountId: account.id, reason: 'PASSWORD_RESET', sessionCount: revoked },
        this.opts(account.id),
      ),
    );
  }

  // ------------------------------------------------------------------------------- helpers ----

  private async requireAccount(accountId: string): Promise<AccountRecord> {
    const account = await this.accounts.findById(accountId);
    if (!account || account.deletedAt) throw ApiError.unauthenticated();
    return account;
  }

  private opts(accountId: string) {
    return {
      aggregateId: accountId,
      correlationId: getRequestContext()?.correlationId ?? uuidv7(),
      source: SOURCE,
      actorId: accountId,
    };
  }

  private publish(event: Parameters<EventPublisher['publish']>[0]): Promise<void> {
    return this.events.publish(event);
  }
}
