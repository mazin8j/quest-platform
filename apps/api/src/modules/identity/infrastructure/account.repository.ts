import { Inject, Injectable } from '@nestjs/common';
import type {
  AccountState,
  ConsentSource,
  ConsentType,
  IdentityProvider,
  Role,
} from '@quest/types';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';

import { uuidv7 } from '../../../common/ids/uuid-v7';
import { DATABASE, type Database } from '../../../infrastructure/database/database.module';
import type { Executor } from '../../../infrastructure/database/executor';
import {
  account,
  accountCredential,
  accountIdentity,
  accountRole,
  consentRecord,
} from '../../../infrastructure/database/schema/identity';
import type { AccountRecord } from '../domain/account';

export interface NewAccount {
  id: string;
  email: string;
  emailVerifiedAt: Date | null;
  state: AccountState;
  dateOfBirth: string;
}

export interface CredentialRecord {
  accountId: string;
  passwordHash: string;
  passwordChangedAt: Date;
  failedAttempts: number;
  lockedUntil: Date | null;
}

interface ConsentRawRow {
  id: string;
  consent_type: ConsentType;
  document_version: string | null;
  granted: boolean;
  source: ConsentSource;
  recorded_at: string | Date;
}

export interface ConsentRow {
  id: string;
  consentType: ConsentType;
  documentVersion: string | null;
  granted: boolean;
  source: ConsentSource;
  recordedAt: Date;
}

/**
 * ACCOUNT aggregate persistence: account row, credential, external identities, role ledger and
 * consent ledger. Only the Identity module writes these tables.
 */
@Injectable()
export class AccountRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  private exec(tx?: Executor): Executor {
    return tx ?? this.db;
  }

  /**
   * Lifecycle states for many accounts in one query, keyed by account id. Used by the owner
   * eligibility port so a page of Quests costs one account query rather than one per row.
   * Selects only the state column: nothing else about an account leaves through this path.
   */
  async statesByIds(ids: readonly string[], tx?: Executor): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const rows = await this.exec(tx)
      .select({ id: account.id, state: account.state })
      .from(account)
      .where(inArray(account.id, [...ids]));
    return new Map(rows.map((row) => [row.id, row.state]));
  }

  async findById(id: string, tx?: Executor): Promise<AccountRecord | undefined> {
    const rows = await this.exec(tx).select().from(account).where(eq(account.id, id)).limit(1);
    return rows[0] ? toRecord(rows[0]) : undefined;
  }

  /**
   * Row-locking read for lifecycle writers that must not race a concurrent state change
   * (audit P01-01: the deletion job and a user cancellation both mutate the same row).
   * Requires a transaction executor — `FOR UPDATE` outside one holds no lock.
   */
  async findByIdForUpdate(id: string, tx: Executor): Promise<AccountRecord | undefined> {
    const rows = await tx.select().from(account).where(eq(account.id, id)).limit(1).for('update');
    return rows[0] ? toRecord(rows[0]) : undefined;
  }

  /** Live (non-deleted) account by email, case-insensitive. */
  async findLiveByEmail(email: string, tx?: Executor): Promise<AccountRecord | undefined> {
    const rows = await this.exec(tx)
      .select()
      .from(account)
      .where(and(sql`lower(${account.email}) = ${email.toLowerCase()}`, isNull(account.deletedAt)))
      .limit(1);
    return rows[0] ? toRecord(rows[0]) : undefined;
  }

  async insert(input: NewAccount, tx?: Executor): Promise<AccountRecord> {
    const rows = await this.exec(tx)
      .insert(account)
      .values({
        id: input.id,
        email: input.email,
        emailVerifiedAt: input.emailVerifiedAt,
        state: input.state,
        dateOfBirth: input.dateOfBirth,
      })
      .returning();
    const row = rows[0];
    if (!row) throw new Error('Account insert returned no row');
    return toRecord(row);
  }

  async update(
    id: string,
    patch: Partial<{
      email: string | null;
      emailVerifiedAt: Date | null;
      emailTombstone: string | null;
      state: AccountState;
      lastLoginAt: Date | null;
      deactivatedAt: Date | null;
      suspendedAt: Date | null;
      suspendedBy: string | null;
      suspensionReason: string | null;
      deletedAt: Date | null;
    }>,
    tx?: Executor,
  ): Promise<void> {
    await this.exec(tx).update(account).set(patch).where(eq(account.id, id));
  }

  /** Deletion cascade: the DOB is replaced by a sentinel so no personal fact remains. */
  async anonymiseDateOfBirth(id: string, tx?: Executor): Promise<void> {
    await this.exec(tx)
      .update(account)
      .set({ dateOfBirth: '1900-01-01' })
      .where(eq(account.id, id));
  }

  // ---- credential ----

  async getCredential(accountId: string, tx?: Executor): Promise<CredentialRecord | undefined> {
    const rows = await this.exec(tx)
      .select()
      .from(accountCredential)
      .where(eq(accountCredential.accountId, accountId))
      .limit(1);
    return rows[0];
  }

  async upsertCredential(accountId: string, passwordHash: string, tx?: Executor): Promise<void> {
    await this.exec(tx)
      .insert(accountCredential)
      .values({
        accountId,
        passwordHash,
        passwordChangedAt: new Date(),
        failedAttempts: 0,
        lockedUntil: null,
      })
      .onConflictDoUpdate({
        target: accountCredential.accountId,
        set: { passwordHash, passwordChangedAt: new Date(), failedAttempts: 0, lockedUntil: null },
      });
  }

  async deleteCredential(accountId: string, tx?: Executor): Promise<void> {
    await this.exec(tx).delete(accountCredential).where(eq(accountCredential.accountId, accountId));
  }

  /** Increments the failure counter and locks when the threshold is reached. Returns the new count. */
  async recordLoginFailure(
    accountId: string,
    maxFailures: number,
    lockMinutes: number,
    tx?: Executor,
  ): Promise<number> {
    // A lapsed lock starts a fresh count: without this the counter stays at the maximum and the
    // next single typo re-locks the account immediately, forever (audit P01-10).
    const lapsed = sql`(${accountCredential.lockedUntil} IS NOT NULL AND ${accountCredential.lockedUntil} <= now())`;
    const rows = await this.exec(tx)
      .update(accountCredential)
      .set({
        failedAttempts: sql`CASE WHEN ${lapsed} THEN 1 ELSE ${accountCredential.failedAttempts} + 1 END`,
        lockedUntil: sql`CASE WHEN ${lapsed} THEN NULL WHEN ${accountCredential.failedAttempts} + 1 >= ${maxFailures} THEN now() + make_interval(mins => ${lockMinutes}) ELSE ${accountCredential.lockedUntil} END`,
      })
      .where(eq(accountCredential.accountId, accountId))
      .returning({ failedAttempts: accountCredential.failedAttempts });
    return rows[0]?.failedAttempts ?? 0;
  }

  async resetLoginFailures(accountId: string, tx?: Executor): Promise<void> {
    await this.exec(tx)
      .update(accountCredential)
      .set({ failedAttempts: 0, lockedUntil: null })
      .where(eq(accountCredential.accountId, accountId));
  }

  // ---- external identities ----

  async findIdentity(
    provider: IdentityProvider,
    subject: string,
    tx?: Executor,
  ): Promise<{ id: string; accountId: string } | undefined> {
    const rows = await this.exec(tx)
      .select({ id: accountIdentity.id, accountId: accountIdentity.accountId })
      .from(accountIdentity)
      .where(
        and(eq(accountIdentity.provider, provider), eq(accountIdentity.providerSubject, subject)),
      )
      .limit(1);
    return rows[0];
  }

  async linkIdentity(
    input: { accountId: string; provider: IdentityProvider; subject: string; email: string | null },
    tx?: Executor,
  ): Promise<void> {
    await this.exec(tx).insert(accountIdentity).values({
      id: uuidv7(),
      accountId: input.accountId,
      provider: input.provider,
      providerSubject: input.subject,
      emailAtLink: input.email,
      lastUsedAt: new Date(),
    });
  }

  async touchIdentity(id: string, tx?: Executor): Promise<void> {
    await this.exec(tx)
      .update(accountIdentity)
      .set({ lastUsedAt: new Date() })
      .where(eq(accountIdentity.id, id));
  }

  async listIdentities(
    accountId: string,
    tx?: Executor,
  ): Promise<Array<{ provider: string; createdAt: Date }>> {
    return this.exec(tx)
      .select({ provider: accountIdentity.provider, createdAt: accountIdentity.createdAt })
      .from(accountIdentity)
      .where(eq(accountIdentity.accountId, accountId));
  }

  async deleteIdentities(accountId: string, tx?: Executor): Promise<void> {
    await this.exec(tx).delete(accountIdentity).where(eq(accountIdentity.accountId, accountId));
  }

  // ---- roles ----

  async activeRoles(accountId: string, tx?: Executor): Promise<Role[]> {
    const rows = await this.exec(tx)
      .select({ role: accountRole.role })
      .from(accountRole)
      .where(and(eq(accountRole.accountId, accountId), isNull(accountRole.revokedAt)));
    return rows.map((r) => r.role as Role);
  }

  /** Returns false when the role was already active (idempotent grant). */
  async grantRole(
    accountId: string,
    role: Role,
    grantedBy: string | null,
    tx?: Executor,
  ): Promise<boolean> {
    const rows = await this.exec(tx)
      .insert(accountRole)
      .values({ id: uuidv7(), accountId, role, grantedBy })
      .onConflictDoNothing()
      .returning({ id: accountRole.id });
    return rows.length > 0;
  }

  async revokeRole(
    accountId: string,
    role: Role,
    revokedBy: string | null,
    tx?: Executor,
  ): Promise<boolean> {
    const rows = await this.exec(tx)
      .update(accountRole)
      .set({ revokedAt: new Date(), revokedBy })
      .where(
        and(
          eq(accountRole.accountId, accountId),
          eq(accountRole.role, role),
          isNull(accountRole.revokedAt),
        ),
      )
      .returning({ id: accountRole.id });
    return rows.length > 0;
  }

  async revokeAllRoles(accountId: string, tx?: Executor): Promise<void> {
    await this.exec(tx)
      .update(accountRole)
      .set({ revokedAt: new Date() })
      .where(and(eq(accountRole.accountId, accountId), isNull(accountRole.revokedAt)));
  }

  // ---- consents ----

  async appendConsents(
    accountId: string,
    entries: ReadonlyArray<{
      type: ConsentType;
      documentVersion: string | null;
      granted: boolean;
      source: ConsentSource;
    }>,
    tx?: Executor,
  ): Promise<void> {
    if (entries.length === 0) return;
    await this.exec(tx)
      .insert(consentRecord)
      .values(
        entries.map((e) => ({
          id: uuidv7(),
          accountId,
          consentType: e.type,
          documentVersion: e.documentVersion,
          granted: e.granted,
          source: e.source,
        })),
      );
  }

  /**
   * Current consent per type: one row each, newest first (audit P01-14). Reading the whole ledger
   * to compute this would be unbounded and, once paged, wrong.
   */
  async latestConsentPerType(accountId: string, tx?: Executor): Promise<ConsentRow[]> {
    const rows = await this.exec(tx).execute(sql`
      SELECT DISTINCT ON (consent_type) id, consent_type, document_version, granted, source, recorded_at
      FROM consent_record
      WHERE account_id = ${accountId}
      ORDER BY consent_type, recorded_at DESC, id DESC
    `);
    const list = (rows as unknown as { rows?: unknown[] }).rows ?? (rows as unknown as unknown[]);
    return (list as ConsentRawRow[]).map((r) => ({
      id: r.id,
      consentType: r.consent_type,
      documentVersion: r.document_version,
      granted: r.granted,
      source: r.source,
      recordedAt: new Date(r.recorded_at),
    }));
  }

  /**
   * Consent history, newest first. Always bounded (audit P01-14): the ledger is append-only and
   * grows for the life of the account, so an unbounded read is a self-inflicted DoS. `cursor` is
   * the (recordedAt, id) pair of the last row of the previous page.
   */
  async listConsents(
    accountId: string,
    page: { limit: number; cursor?: { recordedAt: Date; id: string } },
    tx?: Executor,
  ): Promise<ConsentRow[]> {
    const where = page.cursor
      ? and(
          eq(consentRecord.accountId, accountId),
          sql`(${consentRecord.recordedAt}, ${consentRecord.id}) < (${page.cursor.recordedAt.toISOString()}::timestamptz, ${page.cursor.id}::uuid)`,
        )
      : eq(consentRecord.accountId, accountId);
    const rows = await this.exec(tx)
      .select()
      .from(consentRecord)
      .where(where)
      .orderBy(desc(consentRecord.recordedAt), desc(consentRecord.id))
      .limit(page.limit);
    return rows as ConsentRow[];
  }
}

function toRecord(row: typeof account.$inferSelect): AccountRecord {
  return {
    id: row.id,
    email: row.email,
    emailVerifiedAt: row.emailVerifiedAt,
    state: row.state as AccountState,
    dateOfBirth: row.dateOfBirth,
    lastLoginAt: row.lastLoginAt,
    deactivatedAt: row.deactivatedAt,
    suspendedAt: row.suspendedAt,
    suspensionReason: row.suspensionReason,
    deletedAt: row.deletedAt,
    createdAt: row.createdAt,
  };
}
