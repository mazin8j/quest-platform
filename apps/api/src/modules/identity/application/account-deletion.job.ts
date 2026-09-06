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

  async processDue(now = new Date(), limit = 50): Promise<{ deleted: number; failed: number }> {
    const due = await this.lifecycle.dueDeletions(now, limit);
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
    return { deleted, failed };
  }

  /** Executes the cascade for one account. Returns false when there was nothing to do. */
  async deleteAccount(accountId: string, deletionRequestId: string): Promise<boolean> {
    const account = await this.accounts.findById(accountId);
    if (!account || account.state === AccountState.DELETED) return false;
    if (account.state !== AccountState.DELETION_REQUESTED) return false;
    const next = transitionAccount(account.state, 'COMPLETE_DELETION');
    const deletedAt = new Date();

    // Collect object keys before the rows are deleted; objects are removed after commit.
    const exportKeys = (await this.lifecycle.listExports(accountId))
      .map((e) => e.objectKey)
      .filter((k): k is string => k !== null);
    await this.db.transaction(async (tx) => {
      await this.sessions.deleteSessions(accountId, tx);
      await this.sessions.deleteDevices(accountId, tx);
      await this.accounts.deleteCredential(accountId, tx);
      await this.accounts.deleteIdentities(accountId, tx);
      await this.lifecycle.deleteCodes(accountId, tx);
      await this.lifecycle.deleteExports(accountId, tx);
      await this.accounts.revokeAllRoles(accountId, tx);
      await this.profiles.eraseAccount(accountId, tx);
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
      await this.lifecycle.completeDeletion(deletionRequestId, tx);
      await this.lifecycle.audit({ accountId, eventType: 'DELETION_COMPLETED' }, tx);
    });
    for (const key of exportKeys) await this.storage.delete(key).catch(() => undefined);

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
}
