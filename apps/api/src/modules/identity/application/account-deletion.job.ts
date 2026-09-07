import { Inject, Injectable } from '@nestjs/common';
import { AccountDeleted, createEvent, type EventPublisher } from '@quest/events';
import { AccountState } from '@quest/types';
import { Logger } from 'nestjs-pino';

import { uuidv7 } from '../../../common/ids/uuid-v7';
import { METRICS, type MetricsPort } from '../../../common/observability/metrics.port';
import { DATABASE, type Database } from '../../../infrastructure/database/database.module';
import { EVENT_PUBLISHER } from '../../../infrastructure/events/events.module';
import {
  OBJECT_STORAGE,
  type ObjectStoragePort,
} from '../../../infrastructure/object-storage/object-storage.port';
import { PROFILE_PROVISIONER, type ProfileProvisioningPort } from '../../profiles';
import { transitionAccount } from '../domain/account';
import { emailTombstone } from '../domain/secrets';
import { AccountRepository } from '../infrastructure/account.repository';
import { LifecycleRepository } from '../infrastructure/lifecycle.repository';
import { SessionRepository } from '../infrastructure/session.repository';

const SOURCE = 'api.identity';

/**
 * Account deletion cascade (docs/data/IDENTITY_DATA_MODEL.md "Deletion cascade").
 *
 * Runs after the grace period (DELETION_GRACE_DAYS) for every PENDING request:
 *   1. one transaction anonymises the account row (email → tombstone hash, DOB → 1900-01-01,
 *      state DELETED), hard-deletes credentials, identities, codes, sessions, devices, export
 *      requests, and erases the profile aggregate through the Profiles provisioning port;
 *   2. the consent ledger, role ledger and audit ledger are kept (ids only, no PII) as the legal
 *      record that the account existed and what it agreed to;
 *   3. `identity.account.deleted` is published so every other context erases its own data.
 * Idempotent: a re-run finds the request COMPLETED and does nothing; handlers dedupe on eventId.
 * Invoked by the operator CLI (`pnpm identity:process-deletions`) until a scheduled worker exists.
 */
@Injectable()
export class AccountDeletionJob {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(EVENT_PUBLISHER) private readonly events: EventPublisher,
    @Inject(METRICS) private readonly metrics: MetricsPort,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStoragePort,
    @Inject(PROFILE_PROVISIONER) private readonly profiles: ProfileProvisioningPort,
    private readonly logger: Logger,
    private readonly accounts: AccountRepository,
    private readonly sessions: SessionRepository,
    private readonly lifecycle: LifecycleRepository,
  ) {}

  async processDue(
    now = new Date(),
    limit = 50,
  ): Promise<{ deleted: number; failed: number; paused: number }> {
    const due = await this.lifecycle.dueDeletions(now, limit);
    const paused = await this.lifecycle.pausedDeletions(now);
    if (paused > 0) {
      // Erasure obligations that a suspension holds open: visible to operators, never silent.
      this.metrics.gauge('quest.identity.deletion.paused', paused);
      this.logger.warn({ paused }, 'account deletions paused past their scheduled date');
    }
    let deleted = 0;
    let failed = 0;
    for (const request of due) {
      try {
        if (await this.deleteAccount(request.accountId, request.id)) deleted += 1;
      } catch (error) {
        failed += 1;
        this.logger.error(
          {
            accountId: request.accountId,
            err: error instanceof Error ? error.message : String(error),
          },
          'account deletion failed',
        );
      }
    }
    return { deleted, failed, paused };
  }

  /** Executes the cascade for one account. Returns false when there was nothing to do. */
  async deleteAccount(accountId: string, deletionRequestId: string): Promise<boolean> {
    const deletedAt = new Date();
    // Object keys are collected inside the transaction and deleted only after it commits, so a
    // rollback never leaves a live account without its objects (audit P01-02/P01-03).
    const objectKeys: string[] = [];
    const executed = await this.db.transaction(async (tx) => {
      // The row lock serialises this cascade against a concurrent cancellation: without it the
      // job could commit an erasure the user had already cancelled successfully (audit P01-01).
      const account = await this.accounts.findByIdForUpdate(accountId, tx);
      if (!account || account.state !== AccountState.DELETION_REQUESTED) return false;
      const next = transitionAccount(account.state, 'COMPLETE_DELETION');
      // Claims the request; false means it was cancelled while we waited for the lock.
      if (!(await this.lifecycle.completeDeletion(deletionRequestId, tx))) return false;

      objectKeys.push(
        ...(await this.lifecycle.listExports(accountId, tx))
          .map((e) => e.objectKey)
          .filter((k): k is string => k !== null),
      );
      await this.sessions.deleteSessions(accountId, tx);
      await this.sessions.deleteDevices(accountId, tx);
      await this.accounts.deleteCredential(accountId, tx);
      await this.accounts.deleteIdentities(accountId, tx);
      await this.lifecycle.deleteCodes(accountId, tx);
      await this.lifecycle.deleteExports(accountId, tx);
      await this.accounts.revokeAllRoles(accountId, tx);
      objectKeys.push(...(await this.profiles.eraseAccount(accountId, tx)));
      await this.accounts.update(
        accountId,
        {
          email: null,
          emailTombstone: account.email ? emailTombstone(account.email) : 'unknown',
          emailVerifiedAt: null,
          state: next,
          deletedAt,
          suspendedAt: null,
          suspendedBy: null,
          suspensionReason: null,
          lastLoginAt: null,
        },
        tx,
      );
      await this.accounts.anonymiseDateOfBirth(accountId, tx);
      await this.lifecycle.audit({ accountId, eventType: 'DELETION_COMPLETED' }, tx);
      return true;
    });
    if (!executed) return false;
    for (const key of objectKeys) await this.deleteObject(key, accountId);

    this.metrics.increment('quest.identity.deleted');
    await this.events.publish(
      createEvent(
        AccountDeleted,
        { accountId, deletionRequestId, deletedAt: deletedAt.toISOString() },
        { aggregateId: accountId, correlationId: uuidv7(), source: SOURCE },
      ),
    );
    return true;
  }

  /**
   * Erasure of a storage object. A failure must never abort the cascade (the database record is
   * already gone) but it must never be silent either: the object is orphaned PII and needs an
   * operator sweep (audit P01-04).
   */
  private async deleteObject(objectKey: string, accountId: string): Promise<void> {
    try {
      await this.storage.delete(objectKey);
    } catch (error) {
      this.metrics.increment('quest.identity.storage.erase_failed');
      this.logger.error(
        { accountId, objectKey, err: error instanceof Error ? error.message : String(error) },
        'object storage erase failed during account deletion',
      );
    }
  }
}
