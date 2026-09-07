import { Inject, Injectable } from '@nestjs/common';
import type { QuestState, QuestVisibility, SafetyAssessment } from '@quest/types';
import { and, desc, eq, isNull, lt, or, sql } from 'drizzle-orm';

import { uuidv7 } from '../../../common/ids/uuid-v7';
import { DATABASE, type Database } from '../../../infrastructure/database/database.module';
import type { Executor } from '../../../infrastructure/database/executor';
import {
  quest,
  questAuditLedger,
  questCategory,
  questSafetyAssessment,
  questVersion,
} from '../../../infrastructure/database/schema/quests';
import type { AssessmentRecord, QuestRecord } from '../domain/quest';

export type QuestAuditEventType =
  | 'QUEST_DRAFTED'
  | 'QUEST_REVISED'
  | 'QUEST_ASSESSED'
  | 'QUEST_PUBLISHED'
  | 'QUEST_UNPUBLISHED'
  | 'QUEST_ARCHIVED'
  | 'QUEST_SUSPENDED'
  | 'QUEST_REINSTATED'
  | 'QUEST_ERASED'
  | 'PARTICIPATION_ACCEPTED'
  | 'PARTICIPATION_STARTED'
  | 'PARTICIPATION_CANCELLED'
  | 'PARTICIPATION_COMPLETION_REQUESTED'
  | 'PARTICIPATION_EXPIRED';

export interface NewQuest {
  id: string;
  ownerAccountId: string;
  visibility: QuestVisibility;
  title: string;
  summary: string;
  instructions: string;
  safetyNotes: string | null;
  categoryKey: string;
  difficulty: string;
  evidence: unknown;
  eligibility: unknown;
  locationCountryCode: string | null;
  locationLabel: string | null;
  effortMinutes: number;
  completionWindowHours: number;
  availableFrom: Date | null;
  availableUntil: Date | null;
  contentHash: string;
}

/** Quest aggregate persistence. Only `modules/quests` touches these tables. */
@Injectable()
export class QuestRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  private exec(tx?: Executor): Executor {
    return tx ?? this.db;
  }

  async insert(input: NewQuest, tx?: Executor): Promise<QuestRecord> {
    const rows = await this.exec(tx)
      .insert(quest)
      .values({ ...input, state: 'DRAFT', revision: 1 })
      .returning();
    const row = rows[0];
    if (!row) throw new Error('Quest insert returned no row');
    return toQuest(row);
  }

  async findById(id: string, tx?: Executor): Promise<QuestRecord | undefined> {
    const rows = await this.exec(tx).select().from(quest).where(eq(quest.id, id)).limit(1);
    return rows[0] ? toQuest(rows[0]) : undefined;
  }

  /**
   * Row-locking read for every writer that must not race another (publish vs edit vs suspend).
   * Requires a transaction — `FOR UPDATE` outside one holds no lock.
   */
  async findByIdForUpdate(id: string, tx: Executor): Promise<QuestRecord | undefined> {
    const rows = await tx.select().from(quest).where(eq(quest.id, id)).limit(1).for('update');
    return rows[0] ? toQuest(rows[0]) : undefined;
  }

  async update(
    id: string,
    patch: Partial<{
      state: QuestState;
      visibility: QuestVisibility;
      revision: number;
      title: string;
      summary: string;
      instructions: string;
      safetyNotes: string | null;
      categoryKey: string;
      difficulty: string;
      evidence: unknown;
      eligibility: unknown;
      locationCountryCode: string | null;
      locationLabel: string | null;
      effortMinutes: number;
      completionWindowHours: number;
      availableFrom: Date | null;
      availableUntil: Date | null;
      contentHash: string;
      publishedVersion: number | null;
      publishedContentHash: string | null;
      publishedAssessmentId: string | null;
      publishedAt: Date | null;
      publishedMinimumAgeBand: string | null;
      archivedAt: Date | null;
      suspendedAt: Date | null;
      suspendedBy: string | null;
      suspensionReason: string | null;
      erasedAt: Date | null;
    }>,
    tx?: Executor,
  ): Promise<void> {
    await this.exec(tx).update(quest).set(patch).where(eq(quest.id, id));
  }

  /** Owner's own Quests, newest first, keyset-paged. */
  async listOwned(
    ownerAccountId: string,
    page: { limit: number; cursor?: { createdAt: Date; id: string } },
    tx?: Executor,
  ): Promise<QuestRecord[]> {
    const where = page.cursor
      ? and(
          eq(quest.ownerAccountId, ownerAccountId),
          sql`(${quest.createdAt}, ${quest.id}) < (${page.cursor.createdAt.toISOString()}::timestamptz, ${page.cursor.id}::uuid)`,
        )
      : eq(quest.ownerAccountId, ownerAccountId);
    const rows = await this.exec(tx)
      .select()
      .from(quest)
      .where(and(where, sql`${quest.state} <> 'ERASED'`))
      .orderBy(desc(quest.createdAt), desc(quest.id))
      .limit(page.limit);
    return rows.map(toQuest);
  }

  /**
   * Discovery: published, publicly visible Quests inside their availability window, newest first.
   * Deliberately not ranked — ordering by recency is a Phase 02 decision; Discovery/ranking is a
   * later phase and must not be smuggled in here.
   */
  async listDiscoverable(
    filter: { categoryKey?: string; difficulty?: string; now: Date },
    page: { limit: number; cursor?: { createdAt: Date; id: string } },
    tx?: Executor,
  ): Promise<QuestRecord[]> {
    const conditions = [
      eq(quest.state, 'PUBLISHED'),
      eq(quest.visibility, 'PUBLIC'),
      or(isNull(quest.availableFrom), lt(quest.availableFrom, filter.now)),
      or(isNull(quest.availableUntil), sql`${quest.availableUntil} > ${filter.now.toISOString()}`),
    ];
    if (filter.categoryKey) conditions.push(eq(quest.categoryKey, filter.categoryKey));
    if (filter.difficulty) conditions.push(eq(quest.difficulty, filter.difficulty));
    if (page.cursor) {
      conditions.push(
        sql`(${quest.createdAt}, ${quest.id}) < (${page.cursor.createdAt.toISOString()}::timestamptz, ${page.cursor.id}::uuid)`,
      );
    }
    const rows = await this.exec(tx)
      .select()
      .from(quest)
      .where(and(...conditions))
      .orderBy(desc(quest.createdAt), desc(quest.id))
      .limit(page.limit);
    return rows.map(toQuest);
  }

  async listByOwnerForErasure(ownerAccountId: string, tx?: Executor): Promise<QuestRecord[]> {
    const rows = await this.exec(tx)
      .select()
      .from(quest)
      .where(eq(quest.ownerAccountId, ownerAccountId));
    return rows.map(toQuest);
  }

  // ---- categories ----

  async activeCategories(
    tx?: Executor,
  ): Promise<Array<{ key: string; label: string; sortOrder: number }>> {
    return this.exec(tx)
      .select({
        key: questCategory.key,
        label: questCategory.label,
        sortOrder: questCategory.sortOrder,
      })
      .from(questCategory)
      .where(eq(questCategory.active, true))
      .orderBy(questCategory.sortOrder);
  }

  async categoryExists(key: string, tx?: Executor): Promise<boolean> {
    const rows = await this.exec(tx)
      .select({ key: questCategory.key })
      .from(questCategory)
      .where(and(eq(questCategory.key, key), eq(questCategory.active, true)))
      .limit(1);
    return rows.length > 0;
  }

  // ---- safety assessments (append-only) ----

  async insertAssessment(
    input: {
      questId: string;
      assessment: SafetyAssessment;
      supersedesAssessmentId: string | null;
    },
    tx?: Executor,
  ): Promise<AssessmentRecord> {
    const rows = await this.exec(tx)
      .insert(questSafetyAssessment)
      .values({
        id: input.assessment.assessmentId,
        questId: input.questId,
        contentHash: input.assessment.subjectContentVersion,
        state: input.assessment.state,
        signals: input.assessment.signals,
        restrictions: input.assessment.restrictions ?? null,
        policyVersion: input.assessment.policyVersion,
        decidedBy: input.assessment.decidedBy,
        aiInvocationRef: input.assessment.aiInvocationRef ?? null,
        supersedesAssessmentId: input.supersedesAssessmentId,
      })
      .returning();
    const row = rows[0];
    if (!row) throw new Error('Assessment insert returned no row');
    return toAssessment(row);
  }

  async latestAssessment(questId: string, tx?: Executor): Promise<AssessmentRecord | undefined> {
    const rows = await this.exec(tx)
      .select()
      .from(questSafetyAssessment)
      .where(eq(questSafetyAssessment.questId, questId))
      .orderBy(desc(questSafetyAssessment.assessedAt), desc(questSafetyAssessment.id))
      .limit(1);
    return rows[0] ? toAssessment(rows[0]) : undefined;
  }

  async listAssessments(
    questId: string,
    limit: number,
    tx?: Executor,
  ): Promise<AssessmentRecord[]> {
    const rows = await this.exec(tx)
      .select()
      .from(questSafetyAssessment)
      .where(eq(questSafetyAssessment.questId, questId))
      .orderBy(desc(questSafetyAssessment.assessedAt), desc(questSafetyAssessment.id))
      .limit(limit);
    return rows.map(toAssessment);
  }

  // ---- immutable published versions ----

  async insertVersion(
    input: {
      questId: string;
      version: number;
      contentHash: string;
      content: unknown;
      assessmentId: string;
    },
    tx?: Executor,
  ): Promise<void> {
    await this.exec(tx)
      .insert(questVersion)
      .values({ id: uuidv7(), ...input });
  }

  async findVersion(
    questId: string,
    version: number,
    tx?: Executor,
  ): Promise<{ version: number; contentHash: string; content: unknown } | undefined> {
    const rows = await this.exec(tx)
      .select({
        version: questVersion.version,
        contentHash: questVersion.contentHash,
        content: questVersion.content,
      })
      .from(questVersion)
      .where(and(eq(questVersion.questId, questId), eq(questVersion.version, version)))
      .limit(1);
    return rows[0];
  }

  /**
   * Account erasure: published version snapshots hold a full copy of the Quest content, so they
   * are removed with the Quest itself rather than scrubbed. Safety assessments are kept — their
   * signals are non-PII by contract and they are the record that the decision was made.
   */
  async deleteVersionsForQuest(questId: string, tx?: Executor): Promise<number> {
    const rows = await this.exec(tx)
      .delete(questVersion)
      .where(eq(questVersion.questId, questId))
      .returning({ id: questVersion.id });
    return rows.length;
  }

  // ---- audit ----

  async audit(
    entry: {
      questId: string | null;
      actorId?: string | null;
      eventType: QuestAuditEventType;
      metadata?: Record<string, string | number | boolean>;
    },
    tx?: Executor,
  ): Promise<void> {
    await this.exec(tx)
      .insert(questAuditLedger)
      .values({
        id: uuidv7(),
        questId: entry.questId,
        actorId: entry.actorId ?? null,
        eventType: entry.eventType,
        metadata: entry.metadata ?? {},
      });
  }
}

function toQuest(row: typeof quest.$inferSelect): QuestRecord {
  return {
    id: row.id,
    ownerAccountId: row.ownerAccountId,
    state: row.state as QuestRecord['state'],
    visibility: row.visibility as QuestRecord['visibility'],
    revision: row.revision,
    title: row.title,
    summary: row.summary,
    instructions: row.instructions,
    safetyNotes: row.safetyNotes,
    categoryKey: row.categoryKey,
    difficulty: row.difficulty,
    evidence: row.evidence,
    eligibility: row.eligibility,
    locationCountryCode: row.locationCountryCode,
    locationLabel: row.locationLabel,
    effortMinutes: row.effortMinutes,
    completionWindowHours: row.completionWindowHours,
    availableFrom: row.availableFrom,
    availableUntil: row.availableUntil,
    contentHash: row.contentHash,
    publishedVersion: row.publishedVersion,
    publishedContentHash: row.publishedContentHash,
    publishedAssessmentId: row.publishedAssessmentId,
    publishedAt: row.publishedAt,
    publishedMinimumAgeBand: row.publishedMinimumAgeBand,
    archivedAt: row.archivedAt,
    suspendedAt: row.suspendedAt,
    suspensionReason: row.suspensionReason,
    erasedAt: row.erasedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toAssessment(row: typeof questSafetyAssessment.$inferSelect): AssessmentRecord {
  return {
    id: row.id,
    questId: row.questId,
    contentHash: row.contentHash,
    state: row.state as AssessmentRecord['state'],
    signals: row.signals as AssessmentRecord['signals'],
    restrictions: (row.restrictions ?? undefined) as AssessmentRecord['restrictions'],
    policyVersion: row.policyVersion,
    decidedBy: row.decidedBy as AssessmentRecord['decidedBy'],
    assessedAt: row.assessedAt,
  };
}
