import { Inject, Injectable } from '@nestjs/common';
import type { ClientPlatform } from '@quest/types';
import { and, asc, count, desc, eq, isNull, lt, ne, or, sql } from 'drizzle-orm';

import { uuidv7 } from '../../../common/ids/uuid-v7';
import { DATABASE, type Database } from '../../../infrastructure/database/database.module';
import type { Executor } from '../../../infrastructure/database/executor';
import { authSession, device } from '../../../infrastructure/database/schema/identity';

export interface SessionRecord {
  id: string;
  accountId: string;
  deviceId: string | null;
  refreshTokenHash: string;
  previousRefreshTokenHash: string | null;
  refreshGeneration: number;
  refreshExpiresAt: Date;
  absoluteExpiresAt: Date;
  clientPlatform: ClientPlatform | null;
  clientAppVersion: string | null;
  clientDeviceName: string | null;
  createdAt: Date;
  lastUsedAt: Date;
  revokedAt: Date | null;
  revokedReason: string | null;
}

export interface DeviceRecord {
  id: string;
  accountId: string;
  installationId: string;
  platform: ClientPlatform;
  appVersion: string | null;
  deviceName: string | null;
  pushToken: string | null;
  locale: string | null;
  timezone: string | null;
  lastSeenAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
}

/** AUTHENTICATION persistence: refresh-token sessions and registered devices. */
@Injectable()
export class SessionRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  private exec(tx?: Executor): Executor {
    return tx ?? this.db;
  }

  async insertSession(
    input: Omit<
      SessionRecord,
      'createdAt' | 'lastUsedAt' | 'revokedAt' | 'revokedReason' | 'previousRefreshTokenHash'
    >,
    tx?: Executor,
  ): Promise<SessionRecord> {
    const rows = await this.exec(tx).insert(authSession).values(input).returning();
    const row = rows[0];
    if (!row) throw new Error('Session insert returned no row');
    return toSession(row);
  }

  async findSessionById(id: string, tx?: Executor): Promise<SessionRecord | undefined> {
    const rows = await this.exec(tx)
      .select()
      .from(authSession)
      .where(eq(authSession.id, id))
      .limit(1);
    return rows[0] ? toSession(rows[0]) : undefined;
  }

  /** Matches the current hash first, then the previous one (reuse detection). */
  async findSessionByRefreshHash(
    hash: string,
    tx?: Executor,
  ): Promise<{ session: SessionRecord; matchedPrevious: boolean } | undefined> {
    const rows = await this.exec(tx)
      .select()
      .from(authSession)
      .where(
        or(eq(authSession.refreshTokenHash, hash), eq(authSession.previousRefreshTokenHash, hash)),
      )
      .limit(2);
    const current = rows.find((r) => r.refreshTokenHash === hash);
    if (current) return { session: toSession(current), matchedPrevious: false };
    const previous = rows.find((r) => r.previousRefreshTokenHash === hash);
    return previous ? { session: toSession(previous), matchedPrevious: true } : undefined;
  }

  /** Rotates the refresh token: new hash, next generation, new sliding expiry. */
  async rotateRefreshToken(
    sessionId: string,
    expectedGeneration: number,
    newHash: string,
    refreshExpiresAt: Date,
    tx?: Executor,
  ): Promise<boolean> {
    const rows = await this.exec(tx)
      .update(authSession)
      .set({
        refreshTokenHash: newHash,
        previousRefreshTokenHash: sql`${authSession.refreshTokenHash}`,
        refreshGeneration: expectedGeneration + 1,
        refreshExpiresAt,
        lastUsedAt: new Date(),
      })
      .where(
        and(
          eq(authSession.id, sessionId),
          eq(authSession.refreshGeneration, expectedGeneration),
          isNull(authSession.revokedAt),
        ),
      )
      .returning({ id: authSession.id });
    return rows.length > 0;
  }

  async revokeSession(sessionId: string, reason: string, tx?: Executor): Promise<boolean> {
    const rows = await this.exec(tx)
      .update(authSession)
      .set({ revokedAt: new Date(), revokedReason: reason })
      .where(and(eq(authSession.id, sessionId), isNull(authSession.revokedAt)))
      .returning({ id: authSession.id });
    return rows.length > 0;
  }

  /** Revokes every live session of an account, optionally keeping one. Returns the count revoked. */
  async revokeAllSessions(
    accountId: string,
    reason: string,
    exceptSessionId?: string,
    tx?: Executor,
  ): Promise<number> {
    const rows = await this.exec(tx)
      .update(authSession)
      .set({ revokedAt: new Date(), revokedReason: reason })
      .where(
        and(
          eq(authSession.accountId, accountId),
          isNull(authSession.revokedAt),
          exceptSessionId ? ne(authSession.id, exceptSessionId) : undefined,
        ),
      )
      .returning({ id: authSession.id });
    return rows.length;
  }

  async listLiveSessions(accountId: string, tx?: Executor): Promise<SessionRecord[]> {
    const now = new Date();
    const rows = await this.exec(tx)
      .select()
      .from(authSession)
      .where(
        and(
          eq(authSession.accountId, accountId),
          isNull(authSession.revokedAt),
          sql`${authSession.absoluteExpiresAt} > ${now}`,
          sql`${authSession.refreshExpiresAt} > ${now}`,
        ),
      )
      .orderBy(desc(authSession.createdAt));
    return rows.map(toSession);
  }

  async countLiveSessions(accountId: string, tx?: Executor): Promise<number> {
    const rows = await this.exec(tx)
      .select({ n: count() })
      .from(authSession)
      .where(
        and(
          eq(authSession.accountId, accountId),
          isNull(authSession.revokedAt),
          sql`${authSession.absoluteExpiresAt} > now()`,
        ),
      );
    return Number(rows[0]?.n ?? 0);
  }

  /** Evicts the oldest live sessions beyond `keep` (session cap per account). */
  async evictOldestBeyond(accountId: string, keep: number, tx?: Executor): Promise<number> {
    const now = new Date();
    const live = await this.exec(tx)
      .select({ id: authSession.id })
      .from(authSession)
      .where(
        and(
          eq(authSession.accountId, accountId),
          isNull(authSession.revokedAt),
          sql`${authSession.absoluteExpiresAt} > ${now}`,
          sql`${authSession.refreshExpiresAt} > ${now}`,
        ),
      )
      .orderBy(asc(authSession.lastUsedAt));
    const surplus = live.length - keep;
    if (surplus <= 0) return 0;
    let revoked = 0;
    for (const s of live.slice(0, surplus)) {
      if (await this.revokeSession(s.id, 'SESSION_CAP', tx)) revoked += 1;
    }
    return revoked;
  }

  async deleteSessions(accountId: string, tx?: Executor): Promise<void> {
    await this.exec(tx).delete(authSession).where(eq(authSession.accountId, accountId));
  }

  /** Retention: hard-delete sessions whose absolute expiry passed more than `olderThan`. */
  async purgeExpiredSessions(olderThan: Date, tx?: Executor): Promise<number> {
    const rows = await this.exec(tx)
      .delete(authSession)
      .where(lt(authSession.absoluteExpiresAt, olderThan))
      .returning({ id: authSession.id });
    return rows.length;
  }

  // ---- devices ----

  async upsertDevice(
    input: {
      accountId: string;
      installationId: string;
      platform: ClientPlatform;
      appVersion?: string | null;
      deviceName?: string | null;
      pushToken?: string | null;
      locale?: string | null;
      timezone?: string | null;
    },
    tx?: Executor,
  ): Promise<DeviceRecord> {
    const now = new Date();
    const rows = await this.exec(tx)
      .insert(device)
      .values({
        id: uuidv7(),
        accountId: input.accountId,
        installationId: input.installationId,
        platform: input.platform,
        appVersion: input.appVersion ?? null,
        deviceName: input.deviceName ?? null,
        pushToken: input.pushToken ?? null,
        locale: input.locale ?? null,
        timezone: input.timezone ?? null,
        lastSeenAt: now,
      })
      .onConflictDoUpdate({
        target: [device.accountId, device.installationId],
        set: {
          platform: input.platform,
          lastSeenAt: now,
          revokedAt: null,
          ...(input.appVersion !== undefined ? { appVersion: input.appVersion } : {}),
          ...(input.deviceName !== undefined ? { deviceName: input.deviceName } : {}),
          ...(input.pushToken !== undefined ? { pushToken: input.pushToken } : {}),
          ...(input.locale !== undefined ? { locale: input.locale } : {}),
          ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
        },
      })
      .returning();
    const row = rows[0];
    if (!row) throw new Error('Device upsert returned no row');
    return toDevice(row);
  }

  async listDevices(accountId: string, tx?: Executor): Promise<DeviceRecord[]> {
    const rows = await this.exec(tx)
      .select()
      .from(device)
      .where(and(eq(device.accountId, accountId), isNull(device.revokedAt)))
      .orderBy(desc(device.lastSeenAt));
    return rows.map(toDevice);
  }

  async revokeDevice(accountId: string, deviceId: string, tx?: Executor): Promise<boolean> {
    const rows = await this.exec(tx)
      .update(device)
      .set({ revokedAt: new Date(), pushToken: null })
      .where(
        and(eq(device.id, deviceId), eq(device.accountId, accountId), isNull(device.revokedAt)),
      )
      .returning({ id: device.id });
    return rows.length > 0;
  }

  async deleteDevices(accountId: string, tx?: Executor): Promise<void> {
    await this.exec(tx).delete(device).where(eq(device.accountId, accountId));
  }
}

function toSession(row: typeof authSession.$inferSelect): SessionRecord {
  return { ...row, clientPlatform: row.clientPlatform as ClientPlatform | null };
}

function toDevice(row: typeof device.$inferSelect): DeviceRecord {
  return {
    id: row.id,
    accountId: row.accountId,
    installationId: row.installationId,
    platform: row.platform as ClientPlatform,
    appVersion: row.appVersion,
    deviceName: row.deviceName,
    pushToken: row.pushToken,
    locale: row.locale,
    timezone: row.timezone,
    lastSeenAt: row.lastSeenAt,
    revokedAt: row.revokedAt,
    createdAt: row.createdAt,
  };
}
