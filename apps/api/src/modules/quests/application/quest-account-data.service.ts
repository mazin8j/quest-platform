import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';

import { METRICS, type MetricsPort } from '../../../common/observability/metrics.port';
import {
  ACCOUNT_ERASURE_REGISTRY,
  type AccountErasureRegistryPort,
} from '../../../infrastructure/account-erasure';
import type { Executor } from '../../../infrastructure/database/executor';
import {
  DATA_EXPORT_REGISTRY,
  type DataExportRegistryPort,
} from '../../../infrastructure/data-export/data-export.port';
import type { QuestRecord } from '../domain/quest';
import {
  type ParticipationRecord,
  ParticipationRepository,
} from '../infrastructure/participation.repository';
import { QuestRepository } from '../infrastructure/quest.repository';
import { QuestService, durationOf } from './quest.service';

/** Bound on the rows copied into an export bundle, per collection. */
const EXPORT_MAX_ROWS = 1000;

/**
 * Quests erased per pass. The account-deletion cascade runs inside one transaction, so an
 * unbounded loop over everything an account ever wrote made a large account impossible to delete
 * (audit P02-13): the leading SELECT eventually exceeded `statement_timeout` and every run failed
 * identically. Draining in bounded, row-locked batches keeps each statement small.
 */
const ERASURE_BATCH = 200;
/** Hard stop per cascade run; the deletion job re-runs and finishes the remainder next pass. */
const ERASURE_MAX_BATCHES = 25;

/** Tombstone text left in an erased Quest row. Deliberately not user content. */
const ERASED_TEXT = '[erased]';

/**
 * Evidence and eligibility are JSONB blobs that include owner-authored free text
 * (`evidence.notes`), so they are replaced rather than left in place: a scrubbed title beside a
 * live "text me on 555-0100" note is not erasure (audit P02-04).
 */
const ERASED_EVIDENCE = {
  types: ['TEXT_NOTE'],
  minimumItems: 1,
  requiresLocationAttestation: false,
};
const ERASED_ELIGIBILITY = {
  minimumAgeBand: 'ADULT',
  requiresVerifiedEmail: true,
  allowedCountries: [],
  blockedCountries: [],
};

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
    private readonly questService: QuestService,
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
      afterCommit: (accountId) => this.announceErasure(accountId),
    });
  }

  /** Everything this context holds about the account: the Quests they wrote and the ones they took on. */
  async exportQuestData(accountId: string): Promise<unknown> {
    const [owned, participations] = await Promise.all([
      this.quests.listByOwnerForExport(accountId, EXPORT_MAX_ROWS),
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
      // Reported per collection and only when the bound was actually reached, so a bundle never
      // claims completeness it does not have — nor flags truncation that did not happen (P02-16).
      truncated: {
        quests: owned.length === EXPORT_MAX_ROWS,
        participations: participations.length === EXPORT_MAX_ROWS,
        limit: EXPORT_MAX_ROWS,
      },
    };
  }

  /**
   * Erasure, inside the Identity deletion transaction.
   *
   * The account's own attempts are deleted outright. Their Quests cannot be deleted — other
   * people's participations reference them — so each is driven to the terminal ERASED state:
   * content scrubbed (including the JSONB blobs that carry free text), publication proof cleared,
   * version snapshots destroyed, and any active attempt by another account cancelled.
   *
   * Lock order is quest-then-participation throughout, matching archive/suspend, so a concurrent
   * takedown and a deletion cascade cannot deadlock (audit P02-12), and the quest rows are locked
   * before anything depends on them so a concurrent accept cannot slip an attempt onto a Quest
   * that is being erased (audit P02-08).
   */
  async eraseQuestData(accountId: string, tx: Executor): Promise<string[]> {
    await this.participations.deleteForAccount(accountId, tx);
    // Sanctions this account issued as staff sit on other people's Quests and carry their id and
    // their free-text reason; owner erasure alone would leave both behind (audit P02-14).
    await this.quests.clearSanctionsBy(accountId, tx);

    const erasedAt = new Date();
    const withdrawn: Array<{ quest: QuestRecord; cancelled: ParticipationRecord[] }> = [];
    for (let batch = 0; batch < ERASURE_MAX_BATCHES; batch += 1) {
      const owned = await this.quests.listByOwnerForErasure(accountId, ERASURE_BATCH, tx);
      if (owned.length === 0) break;
      for (const quest of owned) {
        // The quest row is already locked by the batch read; cancelling its attempts comes second.
        const cancelled = await this.participations.cancelActiveForQuest(
          quest.id,
          'QUEST_WITHDRAWN',
          tx,
        );
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
            evidence: ERASED_EVIDENCE,
            eligibility: ERASED_ELIGIBILITY,
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
        withdrawn.push({ quest, cancelled });
      }
      if (owned.length < ERASURE_BATCH) break;
    }

    // Announced only after the whole cascade commits — the registry hands these back to the caller
    // through `pendingAnnouncements`, so an event can never describe state that was rolled back.
    this.pending.set(accountId, withdrawn);
    // No object-storage keys yet: Quest media arrives with Proof in a later phase.
    return [];
  }

  private readonly pending = new Map<
    string,
    Array<{ quest: QuestRecord; cancelled: ParticipationRecord[] }>
  >();

  /**
   * Publishes the erasure events for an account whose deletion has committed. Called by the
   * account-erasure registry after the transaction, so a rolled-back cascade emits nothing.
   */
  async announceErasure(accountId: string): Promise<void> {
    const withdrawn = this.pending.get(accountId);
    this.pending.delete(accountId);
    if (!withdrawn || withdrawn.length === 0) return;
    this.metrics.increment('quest.core.account_erased');
    this.metrics.increment('quest.core.erased', withdrawn.length);
    for (const { quest, cancelled } of withdrawn) {
      await this.questService.announceErasure(quest, cancelled);
    }
  }
}
