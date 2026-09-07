import { Inject, Injectable } from '@nestjs/common';
import type { ParticipationState } from '@quest/types';
import { and, desc, eq, inArray, lte, sql } from 'drizzle-orm';

import { DATABASE, type Database } from '../../../infrastructure/database/database.module';
import type { Executor } from '../../../infrastructure/database/executor';
import { quest, questParticipation } from '../../../infrastructure/database/schema/quests';

export interface ParticipationRecord {
  id: string;
  questId: string;
  accountId: string;
  questVersion: number;
  state: ParticipationState;
  acceptedAt: Date;
  startedAt: Date | null;
  expiresAt: Date | null;
  completionRequestedAt: Date | null;
  completionNote: string | null;
  cancelledAt: Date | null;
  cancelledReason: string | null;
}

const ACTIVE_STATES: ParticipationState[] = ['ACCEPTED', 'STARTED'];

@Injectable()
export class ParticipationRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  private exec(tx?: Executor): Executor {
    return tx ?? this.db;
  }

  async insert(
    input: { id: string; questId: string; accountId: string; questVersion: number },
    tx?: Executor,
  ): Promise<ParticipationRecord> {
    const rows = await this.exec(tx)
      .insert(questParticipation)
      .values({ ...input, state: 'ACCEPTED' })
      .returning();
    const row = rows[0];
    if (!row) throw new Error('Participation insert returned no row');
    return toParticipation(row);
  }

  async findById(id: string, tx?: Executor): Promise<ParticipationRecord | undefined> {
    const rows = await this.exec(tx)
      .select()
      .from(questParticipation)
      .where(eq(questParticipation.id, id))
      .limit(1);
    return rows[0] ? toParticipation(rows[0]) : undefined;
  }

  /** Locking read: two clicks on "Start" must not both transition the same record. */
  async findByIdForUpdate(id: string, tx: Executor): Promise<ParticipationRecord | undefined> {
    const rows = await tx
      .select()
      .from(questParticipation)
      .where(eq(questParticipation.id, id))
      .limit(1)
      .for('update');
    return rows[0] ? toParticipation(rows[0]) : undefined;
  }

  async findActive(
    questId: string,
    accountId: string,
    tx?: Executor,
  ): Promise<ParticipationRecord | undefined> {
    const rows = await this.exec(tx)
      .select()
      .from(questParticipation)
      .where(
        and(
          eq(questParticipation.questId, questId),
          eq(questParticipation.accountId, accountId),
          inArray(questParticipation.state, ACTIVE_STATES),
        ),
      )
      .limit(1);
    return rows[0] ? toParticipation(rows[0]) : undefined;
  }

  /** Which of these Quests the account is currently participating in (discovery badge). */
  async activeQuestIds(accountId: string, questIds: string[], tx?: Executor): Promise<Set<string>> {
    if (questIds.length === 0) return new Set();
    const rows = await this.exec(tx)
      .select({ questId: questParticipation.questId })
      .from(questParticipation)
      .where(
        and(
          eq(questParticipation.accountId, accountId),
          inArray(questParticipation.questId, questIds),
          inArray(questParticipation.state, ACTIVE_STATES),
        ),
      );
    return new Set(rows.map((r) => r.questId));
  }

  async update(
    id: string,
    patch: Partial<{
      state: ParticipationState;
      startedAt: Date | null;
      expiresAt: Date | null;
      completionRequestedAt: Date | null;
      completionNote: string | null;
      cancelledAt: Date | null;
      cancelledReason: string | null;
    }>,
    tx?: Executor,
  ): Promise<void> {
    await this.exec(tx).update(questParticipation).set(patch).where(eq(questParticipation.id, id));
  }

  async listForAccount(
    accountId: string,
    page: { limit: number; cursor?: { acceptedAt: Date; id: string } },
    tx?: Executor,
  ): Promise<Array<ParticipationRecord & { questTitle: string }>> {
    const conditions = [eq(questParticipation.accountId, accountId)];
    if (page.cursor) {
      conditions.push(
        sql`(${questParticipation.acceptedAt}, ${questParticipation.id}) < (${page.cursor.acceptedAt.toISOString()}::timestamptz, ${page.cursor.id}::uuid)`,
      );
    }
    const rows = await this.exec(tx)
      .select({ participation: questParticipation, questTitle: quest.title })
      .from(questParticipation)
      .innerJoin(quest, eq(quest.id, questParticipation.questId))
      .where(and(...conditions))
      .orderBy(desc(questParticipation.acceptedAt), desc(questParticipation.id))
      .limit(page.limit);
    return rows.map((r) => ({ ...toParticipation(r.participation), questTitle: r.questTitle }));
  }

  async countForQuest(questId: string, tx?: Executor): Promise<number> {
    const rows = await this.exec(tx)
      .select({ count: sql<string>`count(*)::text` })
      .from(questParticipation)
      .where(eq(questParticipation.questId, questId));
    return Number(rows[0]?.count ?? '0');
  }

  /** Active attempts on a Quest that is being withdrawn (archive/suspend/erase). */
  async cancelActiveForQuest(
    questId: string,
    reason: string,
    tx?: Executor,
  ): Promise<ParticipationRecord[]> {
    const rows = await this.exec(tx)
      .update(questParticipation)
      .set({ state: 'CANCELLED', cancelledAt: new Date(), cancelledReason: reason })
      .where(
        and(
          eq(questParticipation.questId, questId),
          inArray(questParticipation.state, ACTIVE_STATES),
        ),
      )
      .returning();
    return rows.map(toParticipation);
  }

  /** Expiry sweep input: STARTED attempts whose completion window has elapsed. */
  async dueExpiries(now: Date, limit: number, tx?: Executor): Promise<ParticipationRecord[]> {
    const rows = await this.exec(tx)
      .select()
      .from(questParticipation)
      .where(and(eq(questParticipation.state, 'STARTED'), lte(questParticipation.expiresAt, now)))
      .orderBy(questParticipation.expiresAt)
      .limit(limit);
    return rows.map(toParticipation);
  }

  /** Account erasure: participations by the deleted account are removed entirely. */
  async deleteForAccount(accountId: string, tx?: Executor): Promise<number> {
    const rows = await this.exec(tx)
      .delete(questParticipation)
      .where(eq(questParticipation.accountId, accountId))
      .returning({ id: questParticipation.id });
    return rows.length;
  }

  async listForAccountExport(
    accountId: string,
    limit: number,
    tx?: Executor,
  ): Promise<ParticipationRecord[]> {
    const rows = await this.exec(tx)
      .select()
      .from(questParticipation)
      .where(eq(questParticipation.accountId, accountId))
      .orderBy(desc(questParticipation.acceptedAt))
      .limit(limit);
    return rows.map(toParticipation);
  }
}

function toParticipation(row: typeof questParticipation.$inferSelect): ParticipationRecord {
  return {
    id: row.id,
    questId: row.questId,
    accountId: row.accountId,
    questVersion: row.questVersion,
    state: row.state as ParticipationState,
    acceptedAt: row.acceptedAt,
    startedAt: row.startedAt,
    expiresAt: row.expiresAt,
    completionRequestedAt: row.completionRequestedAt,
    completionNote: row.completionNote,
    cancelledAt: row.cancelledAt,
    cancelledReason: row.cancelledReason,
  };
}
