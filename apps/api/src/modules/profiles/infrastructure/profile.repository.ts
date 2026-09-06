import { Inject, Injectable } from '@nestjs/common';
import type { ChallengeInvitesFrom, LocationVisibility, ProfileVisibility } from '@quest/types';
import { and, asc, count, desc, eq, inArray, or, sql } from 'drizzle-orm';

import { DATABASE, type Database } from '../../../infrastructure/database/database.module';
import type { Executor } from '../../../infrastructure/database/executor';
import {
  accountBlock,
  accountInterest,
  interest,
  privacySettings,
  profile,
} from '../../../infrastructure/database/schema/profiles';

export interface ProfileRecord {
  accountId: string;
  username: string | null;
  displayName: string | null;
  bio: string;
  avatarObjectKey: string | null;
  language: string;
  country: string | null;
  timezone: string | null;
  accountActive: boolean;
  onboardingCompletedAt: Date | null;
  erasedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PrivacyRecord {
  accountId: string;
  profileVisibility: ProfileVisibility;
  locationVisibility: LocationVisibility;
  challengeInvitesFrom: ChallengeInvitesFrom;
  discoverable: boolean;
  updatedAt: Date;
}

export interface InterestRecord {
  key: string;
  label: string;
  category: string;
  sortOrder: number;
}

/** PUBLIC PROFILE persistence: profile, interests, privacy settings, blocks. */
@Injectable()
export class ProfileRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  private exec(tx?: Executor): Executor {
    return tx ?? this.db;
  }

  async findByAccountId(accountId: string, tx?: Executor): Promise<ProfileRecord | undefined> {
    const rows = await this.exec(tx)
      .select()
      .from(profile)
      .where(eq(profile.accountId, accountId))
      .limit(1);
    return rows[0];
  }

  async findByUsername(username: string, tx?: Executor): Promise<ProfileRecord | undefined> {
    const rows = await this.exec(tx)
      .select()
      .from(profile)
      .where(eq(profile.username, username))
      .limit(1);
    return rows[0];
  }

  async insert(
    input: { accountId: string; language: string; country: string | null },
    tx?: Executor,
  ): Promise<void> {
    await this.exec(tx)
      .insert(profile)
      .values({ accountId: input.accountId, language: input.language, country: input.country })
      .onConflictDoNothing();
  }

  async update(
    accountId: string,
    patch: Partial<
      Pick<
        ProfileRecord,
        | 'username'
        | 'displayName'
        | 'bio'
        | 'avatarObjectKey'
        | 'language'
        | 'country'
        | 'timezone'
        | 'accountActive'
        | 'onboardingCompletedAt'
        | 'erasedAt'
      >
    >,
    tx?: Executor,
  ): Promise<void> {
    await this.exec(tx).update(profile).set(patch).where(eq(profile.accountId, accountId));
  }

  // ---- interests ----

  async catalogue(tx?: Executor): Promise<InterestRecord[]> {
    return this.exec(tx)
      .select({
        key: interest.key,
        label: interest.label,
        category: interest.category,
        sortOrder: interest.sortOrder,
      })
      .from(interest)
      .where(eq(interest.active, true))
      .orderBy(asc(interest.sortOrder));
  }

  async activeKeys(keys: string[], tx?: Executor): Promise<string[]> {
    if (keys.length === 0) return [];
    const rows = await this.exec(tx)
      .select({ key: interest.key })
      .from(interest)
      .where(and(inArray(interest.key, keys), eq(interest.active, true)));
    return rows.map((r) => r.key);
  }

  async selectedInterests(accountId: string, tx?: Executor): Promise<string[]> {
    const rows = await this.exec(tx)
      .select({ key: accountInterest.interestKey })
      .from(accountInterest)
      .where(eq(accountInterest.accountId, accountId))
      .orderBy(asc(accountInterest.selectedAt));
    return rows.map((r) => r.key);
  }

  async replaceInterests(accountId: string, keys: string[], tx?: Executor): Promise<void> {
    const e = this.exec(tx);
    await e.delete(accountInterest).where(eq(accountInterest.accountId, accountId));
    if (keys.length > 0) {
      await e.insert(accountInterest).values(keys.map((k) => ({ accountId, interestKey: k })));
    }
  }

  async countInterests(accountId: string, tx?: Executor): Promise<number> {
    const rows = await this.exec(tx)
      .select({ n: count() })
      .from(accountInterest)
      .where(eq(accountInterest.accountId, accountId));
    return Number(rows[0]?.n ?? 0);
  }

  // ---- privacy ----

  async getPrivacy(accountId: string, tx?: Executor): Promise<PrivacyRecord | undefined> {
    const rows = await this.exec(tx)
      .select()
      .from(privacySettings)
      .where(eq(privacySettings.accountId, accountId))
      .limit(1);
    return rows[0] ? toPrivacy(rows[0]) : undefined;
  }

  async upsertPrivacy(
    input: Omit<PrivacyRecord, 'updatedAt'>,
    tx?: Executor,
  ): Promise<PrivacyRecord> {
    const rows = await this.exec(tx)
      .insert(privacySettings)
      .values(input)
      .onConflictDoUpdate({
        target: privacySettings.accountId,
        set: {
          profileVisibility: input.profileVisibility,
          locationVisibility: input.locationVisibility,
          challengeInvitesFrom: input.challengeInvitesFrom,
          discoverable: input.discoverable,
        },
      })
      .returning();
    const row = rows[0];
    if (!row) throw new Error('Privacy upsert returned no row');
    return toPrivacy(row);
  }

  // ---- blocks ----

  async block(blockerAccountId: string, blockedAccountId: string, tx?: Executor): Promise<boolean> {
    const rows = await this.exec(tx)
      .insert(accountBlock)
      .values({ blockerAccountId, blockedAccountId })
      .onConflictDoNothing()
      .returning({ blocker: accountBlock.blockerAccountId });
    return rows.length > 0;
  }

  async unblock(
    blockerAccountId: string,
    blockedAccountId: string,
    tx?: Executor,
  ): Promise<boolean> {
    const rows = await this.exec(tx)
      .delete(accountBlock)
      .where(
        and(
          eq(accountBlock.blockerAccountId, blockerAccountId),
          eq(accountBlock.blockedAccountId, blockedAccountId),
        ),
      )
      .returning({ blocker: accountBlock.blockerAccountId });
    return rows.length > 0;
  }

  async isBlockedEitherWay(a: string, b: string, tx?: Executor): Promise<boolean> {
    const rows = await this.exec(tx)
      .select({ blocker: accountBlock.blockerAccountId })
      .from(accountBlock)
      .where(
        or(
          and(eq(accountBlock.blockerAccountId, a), eq(accountBlock.blockedAccountId, b)),
          and(eq(accountBlock.blockerAccountId, b), eq(accountBlock.blockedAccountId, a)),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  /**
   * Blocks the account created, newest first, always bounded (audit P01-14). `cursor` is the
   * (createdAt, blockedAccountId) pair of the last row of the previous page.
   */
  async listBlocks(
    blockerAccountId: string,
    page: { limit: number; cursor?: { blockedAt: Date; accountId: string } },
    tx?: Executor,
  ): Promise<Array<{ accountId: string; username: string | null; blockedAt: Date }>> {
    const where = page.cursor
      ? and(
          eq(accountBlock.blockerAccountId, blockerAccountId),
          sql`(${accountBlock.createdAt}, ${accountBlock.blockedAccountId}) < (${page.cursor.blockedAt.toISOString()}::timestamptz, ${page.cursor.accountId}::uuid)`,
        )
      : eq(accountBlock.blockerAccountId, blockerAccountId);
    const rows = await this.exec(tx)
      .select({
        accountId: accountBlock.blockedAccountId,
        username: profile.username,
        blockedAt: accountBlock.createdAt,
      })
      .from(accountBlock)
      .leftJoin(profile, eq(profile.accountId, accountBlock.blockedAccountId))
      .where(where)
      .orderBy(desc(accountBlock.createdAt), desc(accountBlock.blockedAccountId))
      .limit(page.limit);
    return rows;
  }

  /** Removes every block the account is part of (deletion cascade). */
  async deleteBlocksInvolving(accountId: string, tx?: Executor): Promise<void> {
    await this.exec(tx)
      .delete(accountBlock)
      .where(
        or(
          eq(accountBlock.blockerAccountId, accountId),
          eq(accountBlock.blockedAccountId, accountId),
        ),
      );
  }

  async deletePrivacy(accountId: string, tx?: Executor): Promise<void> {
    await this.exec(tx).delete(privacySettings).where(eq(privacySettings.accountId, accountId));
  }
}

function toPrivacy(row: typeof privacySettings.$inferSelect): PrivacyRecord {
  return {
    accountId: row.accountId,
    profileVisibility: row.profileVisibility as ProfileVisibility,
    locationVisibility: row.locationVisibility as LocationVisibility,
    challengeInvitesFrom: row.challengeInvitesFrom as ChallengeInvitesFrom,
    discoverable: row.discoverable,
    updatedAt: row.updatedAt,
  };
}
