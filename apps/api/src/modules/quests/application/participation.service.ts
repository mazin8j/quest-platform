import { Inject, Injectable } from '@nestjs/common';
import {
  QuestAccepted,
  QuestCompletionRequested,
  QuestParticipationCancelled,
  QuestStarted,
  createEvent,
  type EventPublisher,
} from '@quest/events';
import {
  type EvidenceRequirement,
  ParticipationState,
  type ParticipationView,
  QuestState,
  evidenceRequirementSchema,
  nextParticipationState,
} from '@quest/types';

import type { Principal } from '../../../common/auth/principal';
import { getRequestContext } from '../../../common/context/request-context';
import { ApiError } from '../../../common/filters/api-error';
import { uuidv7 } from '../../../common/ids/uuid-v7';
import { isUniqueViolation } from '../../../common/persistence/unique-violation';
import { METRICS, type MetricsPort } from '../../../common/observability/metrics.port';
import { DATABASE, type Database } from '../../../infrastructure/database/database.module';
import { EVENT_PUBLISHER } from '../../../infrastructure/events/events.module';
import { OWNER_ELIGIBILITY, type OwnerEligibilityPort } from '../../identity';
import { BLOCK_QUERY, PROFILE_QUERY } from '../../profiles';
import type { BlockQueryPort, ProfileQueryPort } from '../../profiles';
import {
  type AccessGates,
  type OwnerEligible,
  evaluateAcceptEligibility,
} from '../domain/eligibility';
import type { QuestRecord } from '../domain/quest';
import { publishedDecisionPublishable } from '../domain/safety-precedence';
import {
  type ParticipationRecord,
  ParticipationRepository,
} from '../infrastructure/participation.repository';
import { QuestRepository } from '../infrastructure/quest.repository';
import { QuestService } from './quest.service';

const SOURCE = 'api.quests';
const HOUR_MS = 3_600_000;

/**
 * Participation lifecycle: accept → start → completion requested (Phase 02 stops there; evidence
 * verification and rewards are later phases).
 *
 * Every transition locks the row first, so a double click cannot produce two transitions, and the
 * accepted Quest version is frozen on the record so a later edit by the owner can never change the
 * terms somebody already agreed to.
 */
@Injectable()
export class ParticipationService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(EVENT_PUBLISHER) private readonly events: EventPublisher,
    @Inject(METRICS) private readonly metrics: MetricsPort,
    @Inject(BLOCK_QUERY) private readonly blocks: BlockQueryPort,
    @Inject(PROFILE_QUERY) private readonly profiles: ProfileQueryPort,
    @Inject(OWNER_ELIGIBILITY) private readonly ownerEligibility: OwnerEligibilityPort,
    private readonly quests: QuestRepository,
    private readonly participations: ParticipationRepository,
    private readonly questService: QuestService,
  ) {}

  /**
   * Whether the Quest's owner may currently have public content, per Identity (ADR-014).
   *
   * A lookup that fails is counted and reported as ineligible: participation in a Quest whose
   * author cannot be established is refused, never granted by default (audit P02-41).
   */
  private async ownerEligible(ownerAccountId: string): Promise<OwnerEligible> {
    try {
      return await this.ownerEligibility.isPublicationEligible(ownerAccountId);
    } catch {
      this.metrics.increment('quest.core.owner_eligibility_unavailable');
      return false;
    }
  }

  /**
   * Whether the safety decision in force for this Quest's published content still permits it to be
   * public. `null` for an unpublished Quest; `false` when a lookup fails, because participation in
   * content whose safety standing cannot be established is refused, never granted (final delta
   * audit P1-3).
   */
  private async safetyGateFor(quest: QuestRecord): Promise<boolean | null> {
    if (quest.state !== QuestState.PUBLISHED || quest.publishedContentHash === null) return null;
    try {
      const rows = await this.quests.assessmentsForContent(quest.id, quest.publishedContentHash);
      return publishedDecisionPublishable(quest, rows);
    } catch {
      this.metrics.increment('quest.core.safety_decision_unavailable');
      return false;
    }
  }

  async accept(
    principal: Principal,
    questId: string,
    expectedPublishedVersion: number | undefined,
  ): Promise<ParticipationView> {
    const quest = await this.quests.findById(questId);
    if (!quest || quest.state === QuestState.ERASED) throw ApiError.notFound('Quest');

    const [blocked, country, effectiveEligibility, ownerEligible, safetyPublishable] =
      await Promise.all([
        this.blocks.isBlockedEitherWay(principal.accountId, quest.ownerAccountId),
        this.profiles.countryFor(principal.accountId),
        // Folds the *published* assessment's country restrictions into the owner's declared lists,
        // so the geographic half of a RESTRICTED decision is enforced, not merely recorded (P02-02).
        this.questService.effectiveEligibilityOf(quest),
        // Every cross-context lookup is resolved before the transaction opens, so no row lock is
        // ever held while this service waits on another context's connection.
        this.ownerEligible(quest.ownerAccountId),
        this.safetyGateFor(quest),
      ]);

    const eligibility = evaluateAcceptEligibility({
      quest,
      eligibility: effectiveEligibility,
      gates: { ownerEligible, safetyPublishable },
      publishedMinimumAgeBand: this.questService.publishedAgeBandOf(quest),
      viewer: {
        accountId: principal.accountId,
        ageBand: principal.ageBand === 'UNDER_MINIMUM' ? null : principal.ageBand,
        emailVerified: principal.emailVerified,
        countryCode: country,
        // Acceptance is never a staff action: a support permission must not open a participation
        // path an ordinary member would be refused.
        canViewSupport: false,
        blocked,
      },
      now: new Date(),
    });
    if (!eligibility.eligible) {
      // A refusal about a Quest the caller may not know exists is a 404, never an explained 403
      // — otherwise the status code alone confirms someone else's draft (P02-01 / P02-06).
      if (eligibility.hidden) throw ApiError.notFound('Quest');
      throw ApiError.forbidden(`Not eligible: ${eligibility.reasons.join(', ')}`);
    }
    if (quest.publishedVersion === null) throw ApiError.conflict('Quest is not published');
    if (
      expectedPublishedVersion !== undefined &&
      quest.publishedVersion !== expectedPublishedVersion
    ) {
      throw ApiError.conflict('This Quest changed since you opened it; reload and try again');
    }

    const participationId = uuidv7();
    const record = await this.db
      .transaction(async (tx) => {
        // Re-read under lock: publication could have been withdrawn a millisecond ago.
        const locked = await this.quests.findByIdForUpdate(questId, tx);
        if (!locked || locked.state !== QuestState.PUBLISHED) {
          throw ApiError.conflict('Quest is not published');
        }
        // A PUBLISHED row always carries a version (database CHECK), but the type is nullable —
        // treat a missing one as "not published" rather than freezing the attempt at a null.
        const lockedVersion = locked.publishedVersion;
        if (lockedVersion === null) throw ApiError.conflict('Quest is not published');
        if (expectedPublishedVersion !== undefined && lockedVersion !== expectedPublishedVersion) {
          throw ApiError.conflict('This Quest changed since you opened it; reload and try again');
        }
        const created = await this.participations.insert(
          {
            id: participationId,
            questId,
            accountId: principal.accountId,
            questVersion: lockedVersion,
          },
          tx,
        );
        await this.quests.audit(
          {
            questId,
            actorId: principal.accountId,
            eventType: 'PARTICIPATION_ACCEPTED',
            metadata: { questVersion: lockedVersion },
          },
          tx,
        );
        return created;
      })
      .catch((error: unknown) => {
        // `quest_participation_active_uidx`: accepting twice is a conflict, not a second attempt.
        if (isUniqueViolation(error)) {
          throw ApiError.conflict('You already have an active attempt at this Quest');
        }
        throw error;
      });

    this.metrics.increment('quest.participation.accepted');
    await this.events.publish(
      createEvent(
        QuestAccepted,
        {
          participationId: record.id,
          questId,
          accountId: principal.accountId,
          questVersion: record.questVersion,
        },
        this.opts(record.id, principal.accountId),
      ),
    );
    return this.toView(record, quest.title);
  }

  async start(principal: Principal, participationId: string): Promise<ParticipationView> {
    const { record, quest } = await this.transition(
      principal,
      participationId,
      'START',
      (_current, _quest, acceptedWindowHours) => {
        const startedAt = new Date();
        return {
          state: ParticipationState.STARTED,
          startedAt,
          // The window comes from the version the participant accepted, not from the Quest as it
          // is now — an owner cannot shorten somebody's deadline after the fact.
          expiresAt: new Date(startedAt.getTime() + acceptedWindowHours * HOUR_MS),
        };
      },
    );
    this.metrics.increment('quest.participation.started');
    await this.events.publish(
      createEvent(
        QuestStarted,
        {
          participationId: record.id,
          questId: record.questId,
          accountId: principal.accountId,
          questVersion: record.questVersion,
          expiresAt: (record.expiresAt ?? new Date()).toISOString(),
        },
        this.opts(record.id, principal.accountId),
      ),
    );
    return this.toView(record, quest.title);
  }

  async requestCompletion(
    principal: Principal,
    participationId: string,
    note?: string,
  ): Promise<ParticipationView> {
    const { record, quest } = await this.transition(
      principal,
      participationId,
      'REQUEST_COMPLETION',
      (current) => {
        if (current.expiresAt && current.expiresAt.getTime() <= Date.now()) {
          throw ApiError.conflict('The completion window for this attempt has expired');
        }
        return {
          state: ParticipationState.COMPLETION_REQUESTED,
          completionRequestedAt: new Date(),
          completionNote: note ?? null,
        };
      },
    );
    this.metrics.increment('quest.participation.completion_requested');
    await this.events.publish(
      createEvent(
        QuestCompletionRequested,
        {
          participationId: record.id,
          questId: record.questId,
          accountId: principal.accountId,
          questVersion: record.questVersion,
          // Phase 02 records the claim; evidence and verification arrive in Phase 05.
          evidenceRequired: evidenceRequired(this.questService.contentOf(quest).evidence),
        },
        this.opts(record.id, principal.accountId),
      ),
    );
    return this.toView(record, quest.title);
  }

  async cancel(principal: Principal, participationId: string): Promise<ParticipationView> {
    const { record, quest } = await this.transition(principal, participationId, 'CANCEL', () => ({
      state: ParticipationState.CANCELLED,
      cancelledAt: new Date(),
      cancelledReason: 'PARTICIPANT',
    }));
    this.metrics.increment('quest.participation.cancelled');
    await this.events.publish(
      createEvent(
        QuestParticipationCancelled,
        {
          participationId: record.id,
          questId: record.questId,
          accountId: principal.accountId,
          questVersion: record.questVersion,
          reason: 'PARTICIPANT',
        },
        this.opts(record.id, principal.accountId),
      ),
    );
    return this.toView(record, quest.title);
  }

  async list(
    principal: Principal,
    page: { limit: number; cursor?: { acceptedAt: Date; id: string } },
  ): Promise<Array<ParticipationView & { cursorAt: Date }>> {
    const rows = await this.participations.listForAccount(principal.accountId, page);
    return rows.map((row) => ({ ...this.toView(row, row.questTitle), cursorAt: row.acceptedAt }));
  }

  /**
   * Expiry sweep: STARTED attempts whose window elapsed become EXPIRED. Idempotent and
   * retry-safe — it only ever moves rows that are still STARTED.
   */
  async expireDue(now = new Date(), limit = 200): Promise<{ expired: number }> {
    const due = await this.participations.dueExpiries(now, limit);
    let expired = 0;
    for (const record of due) {
      const changed = await this.db.transaction(async (tx) => {
        const locked = await this.participations.findByIdForUpdate(record.id, tx);
        if (!locked || locked.state !== ParticipationState.STARTED) return false;
        if (!locked.expiresAt || locked.expiresAt.getTime() > now.getTime()) return false;
        await this.participations.update(record.id, { state: ParticipationState.EXPIRED }, tx);
        await this.quests.audit(
          {
            questId: locked.questId,
            actorId: null,
            eventType: 'PARTICIPATION_EXPIRED',
            metadata: { participationId: locked.id },
          },
          tx,
        );
        return true;
      });
      if (changed) {
        expired += 1;
        await this.events.publish(
          createEvent(
            QuestParticipationCancelled,
            {
              participationId: record.id,
              questId: record.questId,
              accountId: record.accountId,
              questVersion: record.questVersion,
              reason: 'EXPIRED',
            },
            this.opts(record.id, record.accountId),
          ),
        );
      }
    }
    this.metrics.increment('quest.participation.expired', expired);
    return { expired };
  }

  // ------------------------------------------------------------------------------- helpers ----

  private async transition(
    principal: Principal,
    participationId: string,
    transition: 'START' | 'REQUEST_COMPLETION' | 'CANCEL',
    patchFor: (
      current: ParticipationRecord,
      quest: QuestRecord,
      acceptedWindowHours: number,
    ) => Partial<ParticipationRecord> & { state: ParticipationState },
  ): Promise<{ record: ParticipationRecord; quest: QuestRecord }> {
    // An owner who is no longer eligible takes their Quest out of circulation, so an attempt
    // already in flight can no longer be advanced — but it can always be abandoned. Leaving CANCEL
    // open is deliberate: the alternative traps a participant in an attempt they cannot finish and
    // cannot close, on somebody else's suspension (audit P02-41).
    //
    // Resolved before the transaction, matching `accept`, so no participation row is locked while
    // Identity is queried. The unlocked preview read is advisory only: when it cannot identify the
    // Quest or the participation is not the caller's, the locked read below reports NOT FOUND, and
    // a 404 must not be downgraded to a 409 that confirms the attempt exists.
    //
    // The same reasoning applies to a safety decision that has taken the Quest down: the attempt
    // cannot be advanced, and can still be abandoned (final delta audit P1-3).
    let gates: AccessGates = { ownerEligible: true, safetyPublishable: null };
    if (transition !== 'CANCEL') {
      const preview = await this.participations.findById(participationId);
      const previewQuest =
        preview && preview.accountId === principal.accountId
          ? await this.quests.findById(preview.questId)
          : undefined;
      if (previewQuest !== undefined) {
        const [ownerEligible, safetyPublishable] = await Promise.all([
          this.ownerEligible(previewQuest.ownerAccountId),
          this.safetyGateFor(previewQuest),
        ]);
        gates = { ownerEligible, safetyPublishable };
      }
    }
    return this.db.transaction(async (tx) => {
      const current = await this.participations.findByIdForUpdate(participationId, tx);
      // Another account's participation is not found, never forbidden.
      if (!current || current.accountId !== principal.accountId) {
        throw ApiError.notFound('Participation');
      }
      const next = nextParticipationState(current.state, transition);
      if (!next) {
        throw ApiError.conflict(
          `Cannot ${transition.toLowerCase().replace('_', ' ')} an attempt in state ${current.state}`,
        );
      }
      const quest = await this.quests.findById(current.questId, tx);
      if (!quest) throw ApiError.notFound('Quest');
      // Word for word the message an unpublished Quest gets, and deliberately so: the participant
      // is entitled to know the attempt cannot proceed, and to nothing at all about the account
      // behind it. "Suspended author" and "withdrawn Quest" must be indistinguishable here.
      if (
        transition !== 'CANCEL' &&
        (quest.state !== QuestState.PUBLISHED ||
          !gates.ownerEligible ||
          gates.safetyPublishable === false)
      ) {
        throw ApiError.conflict('This Quest is no longer available');
      }
      const patch = patchFor(current, quest, await this.acceptedWindowHours(current, quest, tx));
      await this.participations.update(participationId, patch, tx);
      await this.quests.audit(
        {
          questId: current.questId,
          actorId: principal.accountId,
          eventType:
            transition === 'START'
              ? 'PARTICIPATION_STARTED'
              : transition === 'CANCEL'
                ? 'PARTICIPATION_CANCELLED'
                : 'PARTICIPATION_COMPLETION_REQUESTED',
          metadata: { participationId },
        },
        tx,
      );
      const updated = await this.participations.findById(participationId, tx);
      if (!updated) throw ApiError.notFound('Participation');
      return { record: updated, quest };
    });
  }

  /**
   * The completion window of the version the participant accepted. Falls back to the Quest's
   * current window only when the snapshot is missing, which cannot happen for a published Quest.
   */
  private async acceptedWindowHours(
    current: ParticipationRecord,
    quest: QuestRecord,
    tx: Parameters<typeof this.quests.findByIdForUpdate>[1],
  ): Promise<number> {
    const snapshot = await this.quests.findVersion(quest.id, current.questVersion, tx);
    const content = snapshot?.content as
      { duration?: { completionWindowHours?: number } } | undefined;
    return content?.duration?.completionWindowHours ?? quest.completionWindowHours;
  }

  toView(record: ParticipationRecord, questTitle: string): ParticipationView {
    return {
      participationId: record.id,
      questId: record.questId,
      questVersion: record.questVersion,
      questTitle,
      state: record.state,
      acceptedAt: record.acceptedAt.toISOString(),
      startedAt: record.startedAt?.toISOString() ?? null,
      expiresAt: record.expiresAt?.toISOString() ?? null,
      completionRequestedAt: record.completionRequestedAt?.toISOString() ?? null,
      cancelledAt: record.cancelledAt?.toISOString() ?? null,
    };
  }

  private opts(participationId: string, actorId: string) {
    return {
      aggregateId: participationId,
      correlationId: getRequestContext()?.correlationId ?? uuidv7(),
      source: SOURCE,
      actorId,
    };
  }
}

function evidenceRequired(evidence: EvidenceRequirement): boolean {
  return evidenceRequirementSchema.parse(evidence).minimumItems > 0;
}
