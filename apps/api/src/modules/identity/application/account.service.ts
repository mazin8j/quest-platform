import { Inject, Injectable } from '@nestjs/common';
import {
  AccountDeactivated,
  AccountDeletionCancelled,
  AccountDeletionRequested,
  AccountReinstated,
  AccountRoleGranted,
  AccountRoleRevoked,
  AccountSessionsRevoked,
  AccountSuspended,
  createEvent,
  type EventPublisher,
} from '@quest/events';
import {
  type AccountState,
  type AccountSupportView,
  type AccountView,
  type ConsentRecord,
  type ConsentState,
  type ConsentType,
  DELETION_GRACE_DAYS,
  type DeletionRequestView,
  type RecordConsentRequest,
  type Role,
  STAFF_ROLES,
} from '@quest/types';

import type { Principal } from '../../../common/auth/principal';
import { getRequestContext } from '../../../common/context/request-context';
import { ApiError } from '../../../common/filters/api-error';
import { uuidv7 } from '../../../common/ids/uuid-v7';
import { METRICS, type MetricsPort } from '../../../common/observability/metrics.port';
import { APP_CONFIG, type AppConfig } from '../../../config/app-config';
import { DATABASE, type Database } from '../../../infrastructure/database/database.module';
import { EVENT_PUBLISHER } from '../../../infrastructure/events/events.module';
import {
  PROFILE_PROVISIONER,
  PROFILE_QUERY,
  type ProfileProvisioningPort,
  type ProfileQueryPort,
} from '../../profiles';
import { type AccountRecord, accountAgeBand, transitionAccount } from '../domain/account';
import { AccountRepository } from '../infrastructure/account.repository';
import {
  type DeletionRequestRecord,
  LifecycleRepository,
} from '../infrastructure/lifecycle.repository';
import { SessionRepository } from '../infrastructure/session.repository';
import { MAILER, type MailerPort } from '../ports/mailer.port';
import { PASSWORD_HASHER, type PasswordHasherPort } from '../ports/password-hasher.port';
import { AccountViewService } from './account-view.service';
import { SessionService } from './session.service';

const SOURCE = 'api.identity';
const DAY_MS = 86_400_000;

/** Account lifecycle (self-service and staff), consent ledger, support view. */
@Injectable()
export class AccountService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(EVENT_PUBLISHER) private readonly events: EventPublisher,
    @Inject(METRICS) private readonly metrics: MetricsPort,
    @Inject(MAILER) private readonly mailer: MailerPort,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasherPort,
    @Inject(PROFILE_PROVISIONER) private readonly profiles: ProfileProvisioningPort,
    @Inject(PROFILE_QUERY) private readonly profileQuery: ProfileQueryPort,
    private readonly accounts: AccountRepository,
    private readonly lifecycle: LifecycleRepository,
    private readonly sessionRepo: SessionRepository,
    private readonly sessions: SessionService,
    private readonly views: AccountViewService,
  ) {}

  // ------------------------------------------------------------------------------------ me ----

  async me(principal: Principal): Promise<AccountView> {
    return this.views.view(await this.requireAccount(principal.accountId));
  }

  // ------------------------------------------------------------------------------ consents ----

  async consentHistory(accountId: string): Promise<ConsentRecord[]> {
    const rows = await this.accounts.listConsents(accountId);
    return rows.map((r) => ({
      consentId: r.id,
      type: r.consentType,
      documentVersion: r.documentVersion,
      granted: r.granted,
      source: r.source,
      recordedAt: r.recordedAt.toISOString(),
    }));
  }

  async consentState(accountId: string): Promise<ConsentState> {
    const rows = await this.accounts.listConsents(accountId); // newest first
    const current: ConsentState['current'] = {};
    for (const r of rows) {
      if (!current[r.consentType]) {
        current[r.consentType] = {
          granted: r.granted,
          documentVersion: r.documentVersion,
          recordedAt: r.recordedAt.toISOString(),
        };
      }
    }
    const requiresReprompt: ConsentType[] = [];
    const required: Array<[ConsentType, string]> = [
      ['TERMS_OF_SERVICE', this.config.AUTH_TERMS_VERSION],
      ['PRIVACY_POLICY', this.config.AUTH_PRIVACY_POLICY_VERSION],
    ];
    for (const [type, version] of required) {
      const c = current[type];
      if (!c || !c.granted || c.documentVersion !== version) requiresReprompt.push(type);
    }
    return { current, requiresReprompt };
  }

  async recordConsent(principal: Principal, input: RecordConsentRequest): Promise<ConsentState> {
    if (input.type === 'AGE_ATTESTATION') {
      throw ApiError.validation([
        { path: 'type', message: 'Age attestation is recorded at registration only' },
      ]);
    }
    const isDocument = input.type === 'TERMS_OF_SERVICE' || input.type === 'PRIVACY_POLICY';
    if (isDocument && !input.granted) {
      throw ApiError.validation([
        {
          path: 'granted',
          message: 'Terms and privacy policy cannot be withdrawn; request deletion instead',
        },
      ]);
    }
    if (isDocument && !input.documentVersion) {
      throw ApiError.validation([
        { path: 'documentVersion', message: 'Required for document consents' },
      ]);
    }
    await this.accounts.appendConsents(principal.accountId, [
      {
        type: input.type,
        documentVersion: input.documentVersion ?? null,
        granted: input.granted,
        source: isDocument ? 'REPROMPT' : 'SETTINGS',
      },
    ]);
    await this.lifecycle.audit({
      accountId: principal.accountId,
      eventType: 'CONSENT_RECORDED',
      metadata: { type: input.type, granted: input.granted },
    });
    this.metrics.increment('quest.identity.consent_recorded', 1, {
      type: input.type,
      granted: input.granted,
    });
    return this.consentState(principal.accountId);
  }

  // -------------------------------------------------------------------------- deactivation ----

  async deactivate(principal: Principal): Promise<void> {
    const account = await this.requireAccount(principal.accountId);
    const next = transitionAccount(account.state, 'DEACTIVATE');
    const revoked = await this.db.transaction(async (tx) => {
      await this.accounts.update(account.id, { state: next, deactivatedAt: new Date() }, tx);
      await this.profiles.setAccountActive(account.id, false, tx);
      await this.lifecycle.audit({ accountId: account.id, eventType: 'DEACTIVATED' }, tx);
      return this.sessions.revokeAll(account.id, 'DEACTIVATED', undefined, tx);
    });
    this.metrics.increment('quest.identity.deactivated');
    await this.events.publish(
      createEvent(
        AccountDeactivated,
        { accountId: account.id },
        this.opts(account.id, principal.accountId),
      ),
    );
    await this.events.publish(
      createEvent(
        AccountSessionsRevoked,
        { accountId: account.id, reason: 'DEACTIVATED', sessionCount: revoked },
        this.opts(account.id, principal.accountId),
      ),
    );
  }

  // ------------------------------------------------------------------------------ deletion ----

  async requestDeletion(
    principal: Principal,
    input: { currentPassword?: string; reason?: string },
  ): Promise<DeletionRequestView> {
    const account = await this.requireAccount(principal.accountId);
    const credential = await this.accounts.getCredential(account.id);
    if (credential) {
      // Re-authentication for the most consequential self-service action.
      if (
        !input.currentPassword ||
        !(await this.hasher.verify(credential.passwordHash, input.currentPassword))
      ) {
        throw ApiError.unauthenticated('Current password is required to request deletion');
      }
    }
    const next = transitionAccount(account.state, 'REQUEST_DELETION');
    const scheduledFor = new Date(Date.now() + DELETION_GRACE_DAYS * DAY_MS);
    const { request, revoked } = await this.db.transaction(async (tx) => {
      const request = await this.lifecycle.createDeletion(
        {
          accountId: account.id,
          previousState: account.state,
          scheduledFor,
          reason: input.reason ?? null,
        },
        tx,
      );
      await this.accounts.update(account.id, { state: next }, tx);
      await this.profiles.setAccountActive(account.id, false, tx);
      await this.lifecycle.audit({ accountId: account.id, eventType: 'DELETION_REQUESTED' }, tx);
      const revoked = await this.sessions.revokeAll(
        account.id,
        'DELETION_REQUESTED',
        principal.sessionId,
        tx,
      );
      return { request, revoked };
    });
    this.metrics.increment('quest.identity.deletion_requested');
    if (account.email) {
      await this.mailer.send({
        to: account.email,
        language: 'en',
        template: { name: 'DELETION_REQUESTED', scheduledFor: scheduledFor.toISOString() },
      });
    }
    await this.events.publish(
      createEvent(
        AccountDeletionRequested,
        {
          accountId: account.id,
          deletionRequestId: request.id,
          scheduledFor: scheduledFor.toISOString(),
        },
        this.opts(account.id, principal.accountId),
      ),
    );
    await this.events.publish(
      createEvent(
        AccountSessionsRevoked,
        { accountId: account.id, reason: 'DELETION_REQUESTED', sessionCount: revoked },
        this.opts(account.id, principal.accountId),
      ),
    );
    return toDeletionView(request);
  }

  async cancelDeletion(principal: Principal): Promise<AccountView> {
    const account = await this.requireAccount(principal.accountId);
    const pending = await this.lifecycle.pendingDeletion(account.id);
    if (!pending) throw ApiError.notFound('Deletion request');
    transitionAccount(account.state, 'CANCEL_DELETION');
    // Restore the state the request was made from: an unverified account stays unverified, a
    // suspended one stays suspended; a deactivated one is reactivated by this very sign-in.
    const next: AccountState =
      pending.previousState === 'PENDING_VERIFICATION' && !account.emailVerifiedAt
        ? 'PENDING_VERIFICATION'
        : pending.previousState === 'SUSPENDED'
          ? 'SUSPENDED'
          : 'ACTIVE';
    await this.db.transaction(async (tx) => {
      await this.lifecycle.cancelDeletion(pending.id, tx);
      await this.accounts.update(account.id, { state: next }, tx);
      await this.profiles.setAccountActive(account.id, next === 'ACTIVE', tx);
      await this.lifecycle.audit({ accountId: account.id, eventType: 'DELETION_CANCELLED' }, tx);
      if (next === 'SUSPENDED')
        await this.sessions.revokeAll(account.id, 'SUSPENDED', undefined, tx);
    });
    this.metrics.increment('quest.identity.deletion_cancelled');
    await this.events.publish(
      createEvent(
        AccountDeletionCancelled,
        { accountId: account.id, deletionRequestId: pending.id },
        this.opts(account.id, principal.accountId),
      ),
    );
    return this.views.view({ ...account, state: next });
  }

  async deletionStatus(principal: Principal): Promise<DeletionRequestView> {
    const latest = await this.lifecycle.latestDeletion(principal.accountId);
    if (!latest) throw ApiError.notFound('Deletion request');
    return toDeletionView(latest);
  }

  // --------------------------------------------------------------------------------- staff ----

  async supportView(accountId: string): Promise<AccountSupportView> {
    const account = await this.accounts.findById(accountId);
    if (!account) throw ApiError.notFound('Account');
    const [roles, facts, deletion, liveSessions] = await Promise.all([
      this.accounts.activeRoles(account.id),
      this.profileQuery.onboardingFacts(account.id),
      this.lifecycle.pendingDeletion(account.id),
      this.sessionRepo.countLiveSessions(account.id),
    ]);
    return {
      accountId: account.id,
      email: account.email ?? '[deleted]',
      emailVerified: account.emailVerifiedAt !== null,
      state: account.state,
      ageBand: accountAgeBand(account),
      roles: ['USER', ...roles],
      createdAt: account.createdAt.toISOString(),
      lastLoginAt: account.lastLoginAt?.toISOString() ?? null,
      suspendedAt: account.suspendedAt?.toISOString() ?? null,
      suspensionReason: account.suspensionReason,
      deletionScheduledFor: deletion?.scheduledFor.toISOString() ?? null,
      activeSessionCount: liveSessions,
      username: facts.username,
    };
  }

  async suspend(staff: Principal, accountId: string, reason: string): Promise<AccountSupportView> {
    if (staff.accountId === accountId)
      throw ApiError.validation([{ path: 'accountId', message: 'Cannot suspend yourself' }]);
    const account = await this.requireAccount(accountId);
    const roles = await this.accounts.activeRoles(account.id);
    if (roles.includes('SUPER_ADMIN'))
      throw ApiError.forbidden('Super admins cannot be suspended through the API');
    const next = transitionAccount(account.state, 'SUSPEND');
    const revoked = await this.db.transaction(async (tx) => {
      await this.accounts.update(
        account.id,
        {
          state: next,
          suspendedAt: new Date(),
          suspendedBy: staff.accountId,
          suspensionReason: reason,
        },
        tx,
      );
      await this.profiles.setAccountActive(account.id, false, tx);
      await this.lifecycle.audit(
        { accountId: account.id, actorId: staff.accountId, eventType: 'SUSPENDED' },
        tx,
      );
      return this.sessions.revokeAll(account.id, 'SUSPENDED', undefined, tx);
    });
    this.metrics.increment('quest.identity.suspended');
    await this.events.publish(
      createEvent(
        AccountSuspended,
        { accountId: account.id, byStaffAccountId: staff.accountId },
        this.opts(account.id, staff.accountId),
      ),
    );
    await this.events.publish(
      createEvent(
        AccountSessionsRevoked,
        { accountId: account.id, reason: 'SUSPENDED', sessionCount: revoked },
        this.opts(account.id, staff.accountId),
      ),
    );
    return this.supportView(account.id);
  }

  async reinstate(staff: Principal, accountId: string): Promise<AccountSupportView> {
    const account = await this.requireAccount(accountId);
    // A deletion request paused by the suspension resumes; otherwise the account becomes usable.
    const pending = await this.lifecycle.pendingDeletion(account.id);
    const next = transitionAccount(account.state, pending ? 'RESUME_DELETION' : 'REINSTATE');
    const usable = next === 'ACTIVE' && account.emailVerifiedAt !== null;
    await this.db.transaction(async (tx) => {
      await this.accounts.update(
        account.id,
        {
          state: usable || next !== 'ACTIVE' ? next : 'PENDING_VERIFICATION',
          suspendedAt: null,
          suspendedBy: null,
          suspensionReason: null,
        },
        tx,
      );
      await this.profiles.setAccountActive(account.id, usable, tx);
      await this.lifecycle.audit(
        { accountId: account.id, actorId: staff.accountId, eventType: 'REINSTATED' },
        tx,
      );
    });
    this.metrics.increment('quest.identity.reinstated');
    await this.events.publish(
      createEvent(
        AccountReinstated,
        { accountId: account.id, byStaffAccountId: staff.accountId },
        this.opts(account.id, staff.accountId),
      ),
    );
    return this.supportView(account.id);
  }

  async grantRole(staff: Principal, accountId: string, role: Role): Promise<AccountSupportView> {
    if (!STAFF_ROLES.includes(role))
      throw ApiError.validation([{ path: 'role', message: 'Not a grantable role' }]);
    const account = await this.requireAccount(accountId);
    if (!account.emailVerifiedAt) throw ApiError.conflict('Staff roles require a verified email');
    const created = await this.accounts.grantRole(account.id, role, staff.accountId);
    if (created) {
      await this.lifecycle.audit({
        accountId: account.id,
        actorId: staff.accountId,
        eventType: 'ROLE_GRANTED',
        metadata: { role },
      });
      // Existing sessions carry stale role claims; force re-issue so the new role applies immediately.
      await this.events.publish(
        createEvent(
          AccountRoleGranted,
          { accountId: account.id, role, byStaffAccountId: staff.accountId },
          this.opts(account.id, staff.accountId),
        ),
      );
    }
    return this.supportView(account.id);
  }

  async revokeRole(staff: Principal, accountId: string, role: Role): Promise<AccountSupportView> {
    const account = await this.requireAccount(accountId);
    if (staff.accountId === accountId && role === 'SUPER_ADMIN') {
      throw ApiError.validation([
        { path: 'role', message: 'Cannot revoke your own SUPER_ADMIN role' },
      ]);
    }
    const removed = await this.accounts.revokeRole(account.id, role, staff.accountId);
    if (removed) {
      await this.lifecycle.audit({
        accountId: account.id,
        actorId: staff.accountId,
        eventType: 'ROLE_REVOKED',
        metadata: { role },
      });
      // Sessions embed roles in the access token; revoke them so the loss of privilege is immediate.
      await this.sessions.revokeAll(account.id, 'ROLE_REVOKED');
      await this.events.publish(
        createEvent(
          AccountRoleRevoked,
          { accountId: account.id, role, byStaffAccountId: staff.accountId },
          this.opts(account.id, staff.accountId),
        ),
      );
    }
    return this.supportView(account.id);
  }

  // ------------------------------------------------------------------------------- helpers ----

  private async requireAccount(accountId: string): Promise<AccountRecord> {
    const account = await this.accounts.findById(accountId);
    if (!account || account.deletedAt) throw ApiError.notFound('Account');
    return account;
  }

  private opts(accountId: string, actorId: string) {
    return {
      aggregateId: accountId,
      correlationId: getRequestContext()?.correlationId ?? uuidv7(),
      source: SOURCE,
      actorId,
    };
  }
}

function toDeletionView(r: DeletionRequestRecord): DeletionRequestView {
  return {
    deletionRequestId: r.id,
    status: r.status,
    requestedAt: r.requestedAt.toISOString(),
    scheduledFor: r.scheduledFor.toISOString(),
    cancelledAt: r.cancelledAt?.toISOString() ?? null,
    completedAt: r.completedAt?.toISOString() ?? null,
  };
}
