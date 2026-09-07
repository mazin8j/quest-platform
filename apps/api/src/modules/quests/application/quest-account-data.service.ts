import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';

import {
  ACCOUNT_ERASURE_REGISTRY,
  type AccountErasureRegistryPort,
} from '../../../infrastructure/account-erasure';
import {
  DATA_EXPORT_REGISTRY,
  type DataExportRegistryPort,
} from '../../../infrastructure/data-export/data-export.port';
import type { Executor } from '../../../infrastructure/database/executor';
import { METRICS, type MetricsPort } from '../../../common/observability/metrics.port';
import { ParticipationRepository } from '../infrastructure/participation.repository';
import { QuestRepository } from '../infrastructure/quest.repository';
import { durationOf } from './quest.service';

/** Bound on the rows copied into an export bundle; the rest are available on request. */
const EXPORT_MAX_ROWS = 1000;

/** Tombstone text left in an erased Quest row. Deliberately not user content. */
const ERASED_TEXT = '[erased]';

/**
 * The Quest context's obligations under the account lifecycle: what leaves in a data export, and
 * what is destroyed on erasure.
 *
 * Both are registered rather than hard-wired, so Identity never learns anything about Quest
 * tables and this context stays the only place that touches them.
 */
@Injectable()
export class QuestAccountDataService implements OnModuleInit {
  constructor(
    @Inject(DATA_EXPORT_REGISTRY) private readonly exports: DataExportRegistryPort,
    @Inject(ACCOUNT_ERASURE_REGISTRY) private readonly erasures: AccountErasureRegistryPort,
    @Inject(METRICS) private readonly metrics: MetricsPort,
    private readonly quests: QuestRepository,
    private readonly participations: ParticipationRepository,
  ) {}

  onModuleInit(): void {
    this.exports.register({
      context: 'quest',
      schemaVersion: 1,
      exportAccountData: (accountId) => this.exportQuestData(accountId),
    });
    this.erasures.register({
      context: 'quest',
      eraseAccountData: (accountId, tx) => this.eraseQuestData(accountId, tx),
    });
  }

  /** Everything this context holds about the account: the Quests they wrote and the ones they took on. */
  async exportQuestData(accountId: string): Promise<unknown> {
    const [owned, participations] = await Promise.all([
      this.quests.listByOwnerForErasure(accountId),
      this.participations.listForAccountExport(accountId, EXPORT_MAX_ROWS),
    ]);
    return {
      quests: owned.map((quest) => ({
        questId: quest.id,
        state: quest.state,
        visibility: quest.visibility,
        title: quest.title,
        summary: quest.summary,
        instructions: quest.instructions,
        safetyNotes: quest.safetyNotes,
        categoryKey: quest.categoryKey,
        difficulty: quest.difficulty,
        duration: durationOf(quest),
        evidence: quest.evidence,
        eligibility: quest.eligibility,
        location: quest.locationCountryCode
          ? { countryCode: quest.locationCountryCode, label: quest.locationLabel }
          : null,
        revision: quest.revision,
        publishedVersion: quest.publishedVersion,
        createdAt: quest.createdAt.toISOString(),
        updatedAt: quest.updatedAt.toISOString(),
        publishedAt: quest.publishedAt?.toISOString() ?? null,
      })),
      participations: participations.map((row) => ({
        participationId: row.id,
        questId: row.questId,
        questVersion: row.questVersion,
        state: row.state,
        acceptedAt: row.acceptedAt.toISOString(),
        startedAt: row.startedAt?.toISOString() ?? null,
        expiresAt: row.expiresAt?.toISOString() ?? null,
        completionRequestedAt: row.completionRequestedAt?.toISOString() ?? null,
        completionNote: row.completionNote,
        cancelledAt: row.cancelledAt?.toISOString() ?? null,
        cancelledReason: row.cancelledReason,
      })),
      truncated: participations.length === EXPORT_MAX_ROWS,
    };
  }

  /**
   * Erasure, inside the Identity deletion transaction.
   *
   * The account's own attempts are deleted outright. Their Quests cannot be deleted — other
   * people's participations reference them — so each is driven to the terminal ERASED state:
   * content scrubbed, publication proof cleared (which also removes it from every discovery
   * query), version snapshots destroyed, and any active attempt by another account cancelled so
   * nobody is left holding an attempt on a Quest whose text no longer exists.
   */
  async eraseQuestData(accountId: string, tx: Executor): Promise<string[]> {
    await this.participations.deleteForAccount(accountId, tx);
    const owned = await this.quests.listByOwnerForErasure(accountId, tx);
    const erasedAt = new Date();
    for (const quest of owned) {
      if (quest.state !== 'ERASED') {
        await this.participations.cancelActiveForQuest(quest.id, 'OWNER_ACCOUNT_ERASED', tx);
      }
      await this.quests.deleteVersionsForQuest(quest.id, tx);
      await this.quests.update(
        quest.id,
        {
          state: 'ERASED',
          visibility: 'PRIVATE',
          title: ERASED_TEXT,
          summary: ERASED_TEXT,
          instructions: ERASED_TEXT,
          safetyNotes: null,
          locationCountryCode: null,
          locationLabel: null,
          // The hash must stop matching any assessment: an erased Quest is never publishable.
          contentHash: `erased:${quest.id}`,
          publishedVersion: null,
          publishedContentHash: null,
          publishedAssessmentId: null,
          publishedAt: null,
          publishedMinimumAgeBand: null,
          erasedAt,
        },
        tx,
      );
      await this.quests.audit(
        { questId: quest.id, actorId: null, eventType: 'QUEST_ERASED', metadata: {} },
        tx,
      );
    }
    this.metrics.increment('quest.core.account_erased');
    // No object-storage keys yet: Quest media arrives with Proof in a later phase.
    return [];
  }
}
