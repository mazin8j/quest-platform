import { Inject, Injectable } from '@nestjs/common';
import type { AccountState, DataExportStatus, DeletionRequestStatus } from '@quest/types';
import { and, desc, eq, lt, lte, ne, or, sql } from 'drizzle-orm';

import { uuidv7 } from '../../../common/ids/uuid-v7';
import { DATABASE, type Database } from '../../../infrastructure/database/database.module';
import type { Executor } from '../../../infrastructure/database/executor';
import {
  account,
  accountDeletionRequest,
  dataExportRequest,
  identityAuditLedger,
  verificationCode,
} from '../../../infrastructure/database/schema/identity';

export type VerificationPurpose = 'VERIFY_EMAIL' | 'RESET_PASSWORD';

export interface VerificationCodeRecord {
  id: string;
  accountId: string;
  purpose: VerificationPurpose;
  codeHash: string;
  expiresAt: Date;
  attempts: number;
  consumedAt: Date | null;
  createdAt: Date;
}

export interface DeletionRequestRecord {
  id: string;
  accountId: string;
  status: DeletionRequestStatus;
  previousState: AccountState;
  reason: string | null;
  requestedAt: Date;
  scheduledFor: Date;
  cancelledAt: Date | null;
  completedAt: Date | null;
}

export interface DataExportRecord {
  id: string;
  accountId: string;
  status: DataExportStatus;
  requestedAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  expiresAt: Date | null;
  objectKey: string | null;
  failureReason: string | null;
}

export type AuditEventType =
  | 'REGISTERED'
  | 'LOGIN_SUCCEEDED'
  | 'LOGIN_FAILED'
  | 'LOGIN_LOCKED'
  | 'LOGIN_BLOCKED_STATE'
  | 'TOKEN_REFRESHED'
  | 'REFRESH_REUSE_DETECTED'
  | 'SESSION_REVOKED'
  | 'SESSIONS_REVOKED_ALL'
  | 'EMAIL_VERIFIED'
  | 'EMAIL_VERIFY_FAILED'
  | 'PASSWORD_CHANGED'
  | 'PASSWORD_RESET_REQUESTED'
  | 'PASSWORD_RESET'
  | 'DEACTIVATED'
  | 'REACTIVATED'
  | 'SUSPENDED'
  | 'REINSTATED'
  | 'DELETION_REQUESTED'
  | 'DELETION_CANCELLED'
  | 'DELETION_COMPLETED'
  | 'ROLE_GRANTED'
  | 'ROLE_REVOKED'
  | 'EXPORT_REQUESTED'
  | 'EXPORT_COMPLETED'
  | 'EXPORT_FAILED'
  | 'DEVICE_REGISTERED'
  | 'DEVICE_REVOKED'
  | 'CONSENT_RECORDED';

/** Verification codes, lifecycle requests (deletion / export) and the security audit ledger. */
@Injectable()
export class LifecycleRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  private exec(tx?: Executor): Executor {
    return tx ?? this.db;
  }

  // ---- verification codes ----

  async latestLiveCode(
    accountId: string,
    purpose: VerificationPurpose,
    tx?: Executor,
  ): Promise<VerificationCodeRecord | undefined> {
    const rows = await this.exec(tx)
      .select()
      .from(verificationCode)
      .where(
        and(
          eq(verificationCode.accountId, accountId),
          eq(verificationCode.purpose, purpose),
          sql`${verificationCode.consumedAt} IS NULL`,
        ),
      )
      .orderBy(desc(verificationCode.createdAt), desc(verificationCode.id))
      .limit(1);
    return rows[0] ? (rows[0] as VerificationCodeRecord) : undefined;
  }

  /** Supersedes any live code for the purpose (consumed) and inserts a fresh one. */
  async issueCode(
    input: { accountId: string; purpose: VerificationPurpose; codeHash: string; expiresAt: Date },
    tx?: Executor,
  ): Promise<VerificationCodeRecord> {
    const e = this.exec(tx);
    await e
      .update(verificationCode)
      .set({ consumedAt: new Date() })
      .where(
        and(
          eq(verificationCode.accountId, input.accountId),
          eq(verificationCode.purpose, input.purpose),
          sql`${verificationCode.consumedAt} IS NULL`,
        ),
      );
    const rows = await e
      .insert(verificationCode)
      .values({ id: uuidv7(), ...input })
      .returning();
    const row = rows[0];
    if (!row) throw new Error('Verification code insert returned no row');
    return row as VerificationCodeRecord;
  }

  async incrementCodeAttempts(id: string, tx?: Executor): Promise<number> {
    const rows = await this.exec(tx)
      .update(verificationCode)
      .set({ attempts: sql`${verificationCode.attempts} + 1` })
      .where(eq(verificationCode.id, id))
      .returning({ attempts: verificationCode.attempts });
    return rows[0]?.attempts ?? 0;
  }

  async consumeCode(id: string, tx?: Executor): Promise<void> {
    await this.exec(tx)
      .update(verificationCode)
      .set({ consumedAt: new Date() })
      .where(eq(verificationCode.id, id));
  }

  async deleteCodes(accountId: string, tx?: Executor): Promise<void> {
    await this.exec(tx).delete(verificationCode).where(eq(verificationCode.accountId, accountId));
  }

  // ---- deletion requests ----

  async pendingDeletion(
    accountId: string,
    tx?: Executor,
  ): Promise<DeletionRequestRecord | undefined> {
    const rows = await this.exec(tx)
      .select()
      .from(accountDeletionRequest)
      .where(
        and(
          eq(accountDeletionRequest.accountId, accountId),
          eq(accountDeletionRequest.status, 'PENDING'),
        ),
      )
      .limit(1);
    return rows[0] ? toDeletion(rows[0]) : undefined;
  }

  async latestDeletion(
    accountId: string,
    tx?: Executor,
  ): Promise<DeletionRequestRecord | undefined> {
    const rows = await this.exec(tx)
      .select()
      .from(accountDeletionRequest)
      .where(eq(accountDeletionRequest.accountId, accountId))
      .orderBy(desc(accountDeletionRequest.requestedAt))
      .limit(1);
    return rows[0] ? toDeletion(rows[0]) : undefined;
  }

  async createDeletion(
    input: {
      accountId: string;
      previousState: AccountState;
      scheduledFor: Date;
      reason: string | null;
    },
    tx?: Executor,
  ): Promise<DeletionRequestRecord> {
    const rows = await this.exec(tx)
      .insert(accountDeletionRequest)
      .values({
        id: uuidv7(),
        accountId: input.accountId,
        status: 'PENDING',
        previousState: input.previousState,
        scheduledFor: input.scheduledFor,
        reason: input.reason,
      })
      .returning();
    const row = rows[0];
    if (!row) throw new Error('Deletion request insert returned no row');
    return toDeletion(row);
  }

  /** Cancels a pending request. Returns false when it was no longer pending (audit P01-01). */
  async cancelDeletion(id: string, tx?: Executor): Promise<boolean> {
    const rows = await this.exec(tx)
      .update(accountDeletionRequest)
      .set({ status: 'CANCELLED', cancelledAt: new Date(), reason: null })
      .where(and(eq(accountDeletionRequest.id, id), eq(accountDeletionRequest.status, 'PENDING')))
      .returning({ id: accountDeletionRequest.id });
    return rows.length > 0;
  }

  /**
   * Marks a pending request COMPLETED. Returns false when it is no longer pending — the caller
   * must abort the cascade, because the user cancelled it after the job picked it up (P01-01).
   */
  async completeDeletion(id: string, tx?: Executor): Promise<boolean> {
    const rows = await this.exec(tx)
      .update(accountDeletionRequest)
      .set({ status: 'COMPLETED', completedAt: new Date(), reason: null })
      .where(and(eq(accountDeletionRequest.id, id), eq(accountDeletionRequest.status, 'PENDING')))
      .returning({ id: accountDeletionRequest.id });
    return rows.length > 0;
  }

  /**
   * Deletion job input: pending requests whose grace period has elapsed **and** whose account is
   * still in DELETION_REQUESTED. Requests paused by a suspension are excluded here (audit P01-06)
   * so they cannot occupy the whole batch window and starve genuinely due deletions;
   * `pausedDeletions` reports them for operator follow-up.
   */
  async dueDeletions(now: Date, limit: number, tx?: Executor): Promise<DeletionRequestRecord[]> {
    const rows = await this.exec(tx)
      .select({ request: accountDeletionRequest })
      .from(accountDeletionRequest)
      .innerJoin(account, eq(account.id, accountDeletionRequest.accountId))
      .where(
        and(
          eq(accountDeletionRequest.status, 'PENDING'),
          lte(accountDeletionRequest.scheduledFor, now),
          eq(account.state, 'DELETION_REQUESTED'),
        ),
      )
      .orderBy(accountDeletionRequest.scheduledFor)
      .limit(limit);
    return rows.map((r) => toDeletion(r.request));
  }

  /** Pending requests past their date whose account left DELETION_REQUESTED (paused erasures). */
  async pausedDeletions(now: Date, tx?: Executor): Promise<number> {
    const rows = await this.exec(tx)
      .select({ id: accountDeletionRequest.id })
      .from(accountDeletionRequest)
      .innerJoin(account, eq(account.id, accountDeletionRequest.accountId))
      .where(
        and(
          eq(accountDeletionRequest.status, 'PENDING'),
          lte(accountDeletionRequest.scheduledFor, now),
          ne(account.state, 'DELETION_REQUESTED'),
        ),
      );
    return rows.length;
  }

  // ---- data export requests ----

  async latestExport(accountId: string, tx?: Executor): Promise<DataExportRecord | undefined> {
    const rows = await this.exec(tx)
      .select()
      .from(dataExportRequest)
      .where(eq(dataExportRequest.accountId, accountId))
      .orderBy(desc(dataExportRequest.requestedAt))
      .limit(1);
    return rows[0] ? toExport(rows[0]) : undefined;
  }

  async findExport(
    accountId: string,
    exportId: string,
    tx?: Executor,
  ): Promise<DataExportRecord | undefined> {
    const rows = await this.exec(tx)
      .select()
      .from(dataExportRequest)
      .where(and(eq(dataExportRequest.id, exportId), eq(dataExportRequest.accountId, accountId)))
      .limit(1);
    return rows[0] ? toExport(rows[0]) : undefined;
  }

  async createExport(accountId: string, tx?: Executor): Promise<DataExportRecord> {
    const rows = await this.exec(tx)
      .insert(dataExportRequest)
      .values({ id: uuidv7(), accountId, status: 'REQUESTED' })
      .returning();
    const row = rows[0];
    if (!row) throw new Error('Export request insert returned no row');
    return toExport(row);
  }

  async updateExport(
    id: string,
    patch: Partial<
      Pick<
        DataExportRecord,
        'status' | 'startedAt' | 'completedAt' | 'expiresAt' | 'objectKey' | 'failureReason'
      >
    >,
    tx?: Executor,
  ): Promise<void> {
    await this.exec(tx).update(dataExportRequest).set(patch).where(eq(dataExportRequest.id, id));
  }

  /** Worker input: REQUESTED items plus PROCESSING items whose worker died (stale start). */
  async openExports(limit: number, staleBefore: Date, tx?: Executor): Promise<DataExportRecord[]> {
    const rows = await this.exec(tx)
      .select()
      .from(dataExportRequest)
      .where(
        or(
          eq(dataExportRequest.status, 'REQUESTED'),
          and(
            eq(dataExportRequest.status, 'PROCESSING'),
            lt(dataExportRequest.startedAt, staleBefore),
          ),
        ),
      )
      .orderBy(dataExportRequest.requestedAt)
      .limit(limit);
    return rows.map(toExport);
  }

  /** Sweep input: READY bundles past their expiry. */
  async expiredReadyExports(now: Date, limit: number, tx?: Executor): Promise<DataExportRecord[]> {
    const rows = await this.exec(tx)
      .select()
      .from(dataExportRequest)
      .where(and(eq(dataExportRequest.status, 'READY'), lte(dataExportRequest.expiresAt, now)))
      .orderBy(dataExportRequest.expiresAt)
      .limit(limit);
    return rows.map(toExport);
  }

  async listExports(accountId: string, tx?: Executor): Promise<DataExportRecord[]> {
    const rows = await this.exec(tx)
      .select()
      .from(dataExportRequest)
      .where(eq(dataExportRequest.accountId, accountId));
    return rows.map(toExport);
  }

  async deleteExports(accountId: string, tx?: Executor): Promise<void> {
    await this.exec(tx).delete(dataExportRequest).where(eq(dataExportRequest.accountId, accountId));
  }

  // ---- audit ledger ----

  async audit(
    input: {
      accountId: string | null;
      actorId?: string | null;
      eventType: AuditEventType;
      sessionId?: string | null;
      metadata?: Record<string, string | number | boolean>;
    },
    tx?: Executor,
  ): Promise<void> {
    await this.exec(tx)
      .insert(identityAuditLedger)
      .values({
        id: uuidv7(),
        accountId: input.accountId,
        actorId: input.actorId ?? null,
        eventType: input.eventType,
        sessionId: input.sessionId ?? null,
        metadata: input.metadata ?? {},
      });
  }

  async listAudit(
    accountId: string,
    limit: number,
    tx?: Executor,
  ): Promise<
    Array<{
      eventType: string;
      occurredAt: Date;
      metadata: Record<string, string | number | boolean>;
    }>
  > {
    return this.exec(tx)
      .select({
        eventType: identityAuditLedger.eventType,
        occurredAt: identityAuditLedger.occurredAt,
        metadata: identityAuditLedger.metadata,
      })
      .from(identityAuditLedger)
      .where(eq(identityAuditLedger.accountId, accountId))
      .orderBy(desc(identityAuditLedger.occurredAt))
      .limit(limit);
  }
}

function toDeletion(row: typeof accountDeletionRequest.$inferSelect): DeletionRequestRecord {
  return {
    ...row,
    status: row.status as DeletionRequestStatus,
    previousState: row.previousState as AccountState,
  };
}

function toExport(row: typeof dataExportRequest.$inferSelect): DataExportRecord {
  return { ...row, status: row.status as DataExportStatus };
}
