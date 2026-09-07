import { Inject, Injectable } from '@nestjs/common';
import {
  QuestDrafted,
  QuestErased,
  QuestParticipationCancelled,
  QuestPublished,
  QuestReinstated,
  QuestRevised,
  QuestSafetyAssessed,
  QuestSuspended,
  QuestUnpublished,
  createEvent,
  type EventPublisher,
} from '@quest/events';
import {
  type CreateQuestRequest,
  type QuestAgeBand,
  type QuestAssessmentView,
  type QuestContent,
  type QuestDuration,
  type QuestEligibility,
  QuestState,
  type QuestSupportView,
  type SafetyAssessment,
  type SafetyDecisionPort,
  type SuspendQuestRequest,
  type UpdateQuestRequest,
  canPublishWithAssessment,
  questContentSchema,
  questDurationSchema,
  questEligibilitySchema,
} from '@quest/types';

import type { Principal } from '../../../common/auth/principal';
import { getRequestContext } from '../../../common/context/request-context';
import { ApiError } from '../../../common/filters/api-error';
import { uuidv7 } from '../../../common/ids/uuid-v7';
import { METRICS, type MetricsPort } from '../../../common/observability/metrics.port';
import { APP_CONFIG, type AppConfig } from '../../../config/app-config';
import { DATABASE, type Database } from '../../../infrastructure/database/database.module';
import { EVENT_PUBLISHER } from '../../../infrastructure/events/events.module';
import { ACCOUNT_FACTS, type AccountFactsPort } from '../../identity';
import { SAFETY_DECISION } from '../../trust-safety';
import {
  type AssessmentRecord,
  type QuestRecord,
  effectiveCountryRules,
  evaluatePublish,
  questContentHash,
  transitionQuest,
} from '../domain/quest';
import {
  type ParticipationRecord,
  ParticipationRepository,
} from '../infrastructure/participation.repository';
import { QuestRepository } from '../infrastructure/quest.repository';

const SOURCE = 'api.quests';
const DAY_MS = 86_400_000;
const SUPPORT_ASSESSMENT_LIMIT = 20;
/** Recorded on the blocking decision a staff suspension writes. */
const STAFF_SANCTION_POLICY_VERSION = 'quest-staff-sanction@1';

/**
 * Quest lifecycle: draft → assess → publish → archive, plus the staff sanction path.
 *
 * Two rules run through every method here:
 *  - ownership is server-derived. The owner is `principal.accountId`; no request body carries an
 *    owner id, and every mutation re-reads the row under a lock before it decides anything.
 *  - publication is earned. Only `publish()` may set `PUBLISHED`, only after `evaluatePublish`
 *    returns allowed, and the row it writes carries the assessment id and hash it relied on (the
 *    database CHECK refuses anything else).
 */
@Injectable()
export class QuestService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(EVENT_PUBLISHER) private readonly events: EventPublisher,
    @Inject(METRICS) private readonly metrics: MetricsPort,
    @Inject(SAFETY_DECISION) private readonly safety: SafetyDecisionPort,
    @Inject(ACCOUNT_FACTS) private readonly owners: AccountFactsPort,
    private readonly quests: QuestRepository,
    private readonly participations: ParticipationRepository,
  ) {}

  // ------------------------------------------------------------------------------ authoring ----

  async create(principal: Principal, input: CreateQuestRequest): Promise<QuestRecord> {
    await this.assertCategory(input.content.categoryKey);
    // Abuse control: an account may hold only so many Quests in a non-terminal state. Without
    // this the only bound is the per-minute throttle, i.e. tens of thousands a day (P02-24).
    const active = await this.quests.countActiveForOwner(principal.accountId);
    if (active >= this.config.QUEST_MAX_ACTIVE_PER_OWNER) {
      throw ApiError.conflict(
        `You already have ${this.config.QUEST_MAX_ACTIVE_PER_OWNER} Quests. Archive one before creating another.`,
      );
    }
    const content = questContentSchema.parse(input.content);
    const duration = questDurationSchema.parse(input.duration);
    const questId = uuidv7();
    const record = await this.db.transaction(async (tx) => {
      const created = await this.quests.insert(
        {
          id: questId,
          ownerAccountId: principal.accountId,
          visibility: input.visibility,
          ...contentColumns(content),
          ...durationColumns(duration),
          contentHash: questContentHash(content),
        },
        tx,
      );
      await this.quests.audit(
        {
          questId,
          actorId: principal.accountId,
          eventType: 'QUEST_DRAFTED',
          metadata: { category: content.categoryKey, difficulty: content.difficulty },
        },
        tx,
      );
      return created;
    });
    this.metrics.increment('quest.core.drafted');
    await this.publishEvent(
      createEvent(
        QuestDrafted,
        {
          questId,
          ownerAccountId: principal.accountId,
          categoryKey: content.categoryKey,
          difficulty: content.difficulty,
          contentHash: record.contentHash,
        },
        this.opts(questId, principal.accountId),
      ),
    );
    return record;
  }

  /**
   * Full replacement of the editable state. A change to any safety-relevant field produces a new
   * content hash, which makes every previous approval stale — so a PUBLISHED Quest is taken out of
   * visibility in the same transaction. That is the whole point: approval belongs to content, not
   * to a Quest id.
   */
  async update(
    principal: Principal,
    questId: string,
    input: UpdateQuestRequest,
  ): Promise<QuestRecord> {
    await this.assertCategory(input.content.categoryKey);
    const content = questContentSchema.parse(input.content);
    const duration = questDurationSchema.parse(input.duration);
    const nextHash = questContentHash(content);

    const { record, unpublished, previousState, safetyRelevantChange, cancelled } =
      await this.db.transaction(async (tx) => {
        const current = await this.lockOwned(questId, principal, tx);
        if (current.revision !== input.expectedRevision) {
          throw ApiError.conflict('This Quest changed since you loaded it; reload and try again');
        }
        if (current.state === QuestState.ARCHIVED || current.state === QuestState.SUSPENDED) {
          throw ApiError.conflict(`A ${current.state} Quest cannot be edited`);
        }
        const safetyRelevantChange = current.contentHash !== nextHash;
        // REVISE is a no-op transition for a DRAFT and an unpublish for a PUBLISHED Quest.
        const nextState = safetyRelevantChange
          ? transitionQuest(current.state, 'REVISE')
          : current.state;

        await this.quests.update(
          questId,
          {
            ...contentColumns(content),
            ...durationColumns(duration),
            visibility: input.visibility,
            contentHash: nextHash,
            revision: current.revision + 1,
            state: nextState,
            ...(safetyRelevantChange
              ? {
                  // The publication proof is cleared together with the state, so no row can claim a
                  // publication that no longer matches its content.
                  publishedContentHash: null,
                  publishedAssessmentId: null,
                  publishedAt: null,
                  publishedMinimumAgeBand: null,
                }
              : {}),
          },
          tx,
        );
        await this.quests.audit(
          {
            questId,
            actorId: principal.accountId,
            eventType: 'QUEST_REVISED',
            metadata: {
              safetyRelevantChange,
              fromState: current.state,
              toState: nextState,
              revision: current.revision + 1,
            },
          },
          tx,
        );
        const wasPublished = current.state === QuestState.PUBLISHED;
        const cancelled =
          wasPublished && safetyRelevantChange
            ? // Attempts in flight are cancelled: the terms they accepted no longer exist publicly.
              await this.withdrawParticipations(questId, tx)
            : [];
        const updated = await this.quests.findById(questId, tx);
        if (!updated) throw ApiError.notFound('Quest');
        return {
          record: updated,
          unpublished: wasPublished && safetyRelevantChange,
          previousState: current.state,
          safetyRelevantChange,
          cancelled,
        };
      });

    this.metrics.increment('quest.core.revised');
    await this.publishEvent(
      createEvent(
        QuestRevised,
        {
          questId,
          ownerAccountId: principal.accountId,
          revision: record.revision,
          contentHash: record.contentHash,
          // The real answer, not a proxy for it: a DRAFT edit changes the hash without changing
          // the state, and a consumer caching a safety verdict must still invalidate it (P02-20).
          safetyRelevantChange,
          previousState,
          state: record.state,
        },
        this.opts(questId, principal.accountId),
      ),
    );
    if (unpublished) {
      await this.publishEvent(
        createEvent(
          QuestUnpublished,
          {
            questId,
            ownerAccountId: principal.accountId,
            reason: 'REVISED',
            state: record.state,
          },
          this.opts(questId, principal.accountId),
        ),
      );
      await this.announceCancellations(questId, principal.accountId, cancelled);
    }
    return record;
  }

  // -------------------------------------------------------------------------------- safety ----

  /**
   * Records a safety decision for the Quest's current content. Always append-only: a new decision
   * supersedes the previous one, nothing is mutated, and the outcome may move the Quest to
   * IN_REVIEW. Never publishes anything by itself.
   */
  async assess(principal: Principal, questId: string): Promise<QuestAssessmentView> {
    const quest = await this.requireOwned(questId, principal);
    const content = this.contentOf(quest);
    const assessment: SafetyAssessment = await this.safety.assess({
      subjectType: 'QUEST',
      subjectId: quest.id,
      subjectContentVersion: quest.contentHash,
      text: {
        title: quest.title,
        summary: quest.summary,
        instructions: quest.instructions,
        safetyNotes: quest.safetyNotes ?? '',
      },
      // Whether minors may take part, derived from the Quest's own eligibility — never identity.
      audienceIncludesMinors: content.eligibility.minimumAgeBand !== 'ADULT',
      countryCode: quest.locationCountryCode ?? undefined,
      correlationId: getRequestContext()?.correlationId,
    });

    const {
      record: stored,
      withdrawn,
      cancelled,
    } = await this.db.transaction(async (tx) => {
      const locked = await this.lockOwned(questId, principal, tx);
      // The content may have changed while the policy engine ran: an assessment must never be
      // attributed to content it did not see.
      if (locked.contentHash !== quest.contentHash) {
        throw ApiError.conflict('This Quest changed during assessment; request a new assessment');
      }
      const previous = await this.quests.latestAssessment(questId, tx);
      const record = await this.quests.insertAssessment(
        { questId, assessment, supersedesAssessmentId: previous?.id ?? null },
        tx,
      );

      // A decision is not advice: an unpublishable outcome about content that is currently live
      // has to take it down, and a favourable one about content parked in review has to release
      // it. Reacting to REVIEW_REQUIRED alone left a REJECTED Quest publicly visible (P02-09) and
      // left IN_REVIEW with no exit (P02-21).
      const publishable = canPublishWithAssessment(
        toSharedAssessment(record),
        locked.contentHash,
      ).allowed;
      let cancelledRows: ParticipationRecord[] = [];
      let withdrawnFrom: QuestState | null = null;

      if (!publishable && locked.state === QuestState.PUBLISHED) {
        // Full withdrawal, exactly as archive/suspend do it: state, publication proof and the
        // attempts that were accepted under it (P02-22).
        withdrawnFrom = locked.state;
        await this.quests.update(
          questId,
          {
            state: transitionQuest(locked.state, 'REQUIRE_REVIEW'),
            publishedContentHash: null,
            publishedAssessmentId: null,
            publishedAt: null,
            publishedMinimumAgeBand: null,
          },
          tx,
        );
        cancelledRows = await this.withdrawParticipations(questId, tx);
      } else if (!publishable && locked.state === QuestState.DRAFT) {
        await this.quests.update(
          questId,
          { state: transitionQuest(locked.state, 'REQUIRE_REVIEW') },
          tx,
        );
      } else if (publishable && locked.state === QuestState.IN_REVIEW) {
        // The Quest may leave review without a content edit: a transient engine failure, or a
        // policy correction, must not park a Quest forever (P02-21).
        await this.quests.update(questId, { state: transitionQuest(locked.state, 'REVISE') }, tx);
      }
      // ARCHIVED and SUSPENDED are left where they are: the decision is still recorded (it is
      // what a moderator needs), but neither state is publishable, so there is nothing to change.

      await this.quests.audit(
        {
          questId,
          actorId: principal.accountId,
          eventType: 'QUEST_ASSESSED',
          metadata: {
            safetyState: assessment.state,
            policyVersion: assessment.policyVersion,
            publishable,
            fromState: locked.state,
          },
        },
        tx,
      );
      return { record, withdrawn: withdrawnFrom, cancelled: cancelledRows };
    });

    this.metrics.increment('quest.core.assessed', 1, { state: assessment.state });
    await this.publishEvent(
      createEvent(
        QuestSafetyAssessed,
        {
          questId,
          ownerAccountId: quest.ownerAccountId,
          assessmentId: stored.id,
          contentHash: stored.contentHash,
          safetyState: stored.state,
          policyVersion: stored.policyVersion,
          decidedBy: stored.decidedBy,
          categories: stored.signals.map((s) => s.category),
        },
        this.opts(questId, principal.accountId),
      ),
    );
    if (withdrawn) {
      await this.publishEvent(
        createEvent(
          QuestUnpublished,
          {
            questId,
            ownerAccountId: quest.ownerAccountId,
            reason: 'REVISED',
            state: QuestState.IN_REVIEW,
          },
          this.opts(questId, principal.accountId),
        ),
      );
      await this.announceCancellations(questId, principal.accountId, cancelled);
    }
    return this.toAssessmentView(stored, quest.contentHash);
  }

  // ------------------------------------------------------------------------------- publish ----

  /** The only path to visibility. Every rejection is a 409 listing machine-readable blockers. */
  async publish(
    principal: Principal,
    questId: string,
    expectedContentHash: string,
  ): Promise<QuestRecord> {
    const owner = await this.owners.factsFor(principal.accountId);
    const now = new Date();

    const { record, assessmentId, version, minimumAgeBand } = await this.db.transaction(
      async (tx) => {
        const quest = await this.lockOwned(questId, principal, tx);
        const assessment = await this.quests.latestAssessment(questId, tx);
        const eligibility = questEligibilitySchema.parse(quest.eligibility);
        const decision = evaluatePublish({
          quest,
          latestAssessment: assessment ?? null,
          declaredMinimumAgeBand: eligibility.minimumAgeBand,
          owner,
          actorAccountId: principal.accountId,
          expectedContentHash,
          maxAssessmentAgeMs: this.config.QUEST_ASSESSMENT_MAX_AGE_DAYS * DAY_MS,
          now,
        });
        if (!decision.allowed || !assessment) {
          this.metrics.increment('quest.core.publish_blocked');
          // Blockers are machine-readable so a client can explain them without parsing prose.
          throw ApiError.conflict(
            `This Quest cannot be published: ${decision.blockers.join(', ')}`,
            decision.blockers.map((blocker) => ({ path: 'publish', message: blocker })),
          );
        }
        const nextVersion = (quest.publishedVersion ?? 0) + 1;
        await this.quests.update(
          questId,
          {
            state: transitionQuest(quest.state, 'PUBLISH'),
            publishedVersion: nextVersion,
            publishedContentHash: quest.contentHash,
            publishedAssessmentId: assessment.id,
            publishedAt: now,
            publishedMinimumAgeBand: decision.minimumAgeBand,
            archivedAt: null,
          },
          tx,
        );
        await this.quests.insertVersion(
          {
            questId,
            version: nextVersion,
            contentHash: quest.contentHash,
            content: {
              ...this.contentOf(quest),
              duration: durationOf(quest),
              visibility: quest.visibility,
              minimumAgeBand: decision.minimumAgeBand,
            },
            assessmentId: assessment.id,
          },
          tx,
        );
        await this.quests.audit(
          {
            questId,
            actorId: principal.accountId,
            eventType: 'QUEST_PUBLISHED',
            metadata: {
              version: nextVersion,
              assessmentId: assessment.id,
              safetyState: assessment.state,
            },
          },
          tx,
        );
        const updated = await this.quests.findById(questId, tx);
        if (!updated) throw ApiError.notFound('Quest');
        return {
          record: updated,
          assessmentId: assessment.id,
          version: nextVersion,
          minimumAgeBand: decision.minimumAgeBand,
        };
      },
    );

    this.metrics.increment('quest.core.published');
    await this.publishEvent(
      createEvent(
        QuestPublished,
        {
          questId,
          ownerAccountId: principal.accountId,
          version,
          contentHash: record.contentHash,
          assessmentId,
          visibility: record.visibility,
          minimumAgeBand,
        },
        this.opts(questId, principal.accountId),
      ),
    );
    return record;
  }

  async archive(principal: Principal, questId: string, reason?: string): Promise<QuestRecord> {
    const { updated: record, cancelled } = await this.db.transaction(async (tx) => {
      const quest = await this.lockOwned(questId, principal, tx);
      const next = transitionQuest(quest.state, 'ARCHIVE');
      await this.quests.update(
        questId,
        {
          state: next,
          archivedAt: new Date(),
          publishedContentHash: null,
          publishedAssessmentId: null,
          publishedAt: null,
          publishedMinimumAgeBand: null,
        },
        tx,
      );
      const cancelled = await this.withdrawParticipations(questId, tx);
      await this.quests.audit(
        {
          questId,
          actorId: principal.accountId,
          eventType: 'QUEST_ARCHIVED',
          // The owner's reason is retained in the ledger rather than accepted and discarded.
          metadata: { reason: reason ?? '', cancelledAttempts: cancelled.length },
        },
        tx,
      );
      const updated = await this.quests.findById(questId, tx);
      if (!updated) throw ApiError.notFound('Quest');
      return { updated, cancelled };
    });
    this.metrics.increment('quest.core.archived');
    await this.publishEvent(
      createEvent(
        QuestUnpublished,
        {
          questId,
          ownerAccountId: principal.accountId,
          reason: 'ARCHIVED',
          state: record.state,
        },
        this.opts(questId, principal.accountId),
      ),
    );
    await this.announceCancellations(questId, principal.accountId, cancelled);
    return record;
  }

  // --------------------------------------------------------------------------------- staff ----

  async suspend(
    staff: Principal,
    questId: string,
    input: SuspendQuestRequest,
  ): Promise<QuestSupportView> {
    const { quest: record, cancelled } = await this.db.transaction(async (tx) => {
      const quest = await this.quests.findByIdForUpdate(questId, tx);
      if (!quest || quest.state === QuestState.ERASED) throw ApiError.notFound('Quest');
      const next = transitionQuest(quest.state, 'SUSPEND');
      await this.quests.update(
        questId,
        {
          state: next,
          suspendedAt: new Date(),
          suspendedBy: staff.accountId,
          suspensionReason: input.reason,
          publishedContentHash: null,
          publishedAssessmentId: null,
          publishedAt: null,
          publishedMinimumAgeBand: null,
        },
        tx,
      );
      // A human decision about this exact content, recorded in the append-only ledger. Without it
      // the pre-suspension approval stays the latest one, and suspend → reinstate → publish would
      // put identical content back in front of users with no new safety decision (P02-10).
      const previous = await this.quests.latestAssessment(questId, tx);
      await this.quests.insertAssessment(
        {
          questId,
          assessment: {
            assessmentId: uuidv7(),
            subjectType: 'QUEST',
            subjectId: questId,
            subjectContentVersion: quest.contentHash,
            state: 'REVIEW_REQUIRED',
            signals: [],
            policyVersion: STAFF_SANCTION_POLICY_VERSION,
            decidedBy: 'HUMAN',
            assessedAt: new Date().toISOString(),
            supersedesAssessmentId: previous?.id,
          },
          supersedesAssessmentId: previous?.id ?? null,
        },
        tx,
      );
      const cancelledRows = await this.withdrawParticipations(questId, tx);
      await this.quests.audit(
        {
          questId,
          actorId: staff.accountId,
          eventType: 'QUEST_SUSPENDED',
          // The reason survives reinstatement here; the row's own column is cleared when the
          // sanction is lifted, so the ledger is the durable record of why (P02-23).
          metadata: { reason: input.reason, cancelledAttempts: cancelledRows.length },
        },
        tx,
      );
      return { quest, cancelled: cancelledRows };
    });
    this.metrics.increment('quest.core.suspended');
    await this.publishEvent(
      createEvent(
        QuestSuspended,
        { questId, ownerAccountId: record.ownerAccountId, byStaffAccountId: staff.accountId },
        this.opts(questId, staff.accountId),
      ),
    );
    // A sanction is an unpublication: consumers that de-index or invalidate must hear about it
    // through the same event every other withdrawal uses (P02-17).
    await this.publishEvent(
      createEvent(
        QuestUnpublished,
        {
          questId,
          ownerAccountId: record.ownerAccountId,
          reason: 'SUSPENDED',
          state: QuestState.SUSPENDED,
        },
        this.opts(questId, staff.accountId),
      ),
    );
    await this.announceCancellations(questId, staff.accountId, cancelled);
    return this.supportView(questId);
  }

  /** Reinstatement returns a Quest to DRAFT: visibility must be earned again through the gate. */
  async reinstate(staff: Principal, questId: string): Promise<QuestSupportView> {
    const record = await this.db.transaction(async (tx) => {
      const quest = await this.quests.findByIdForUpdate(questId, tx);
      if (!quest || quest.state === QuestState.ERASED) throw ApiError.notFound('Quest');
      await this.quests.update(
        questId,
        {
          state: transitionQuest(quest.state, 'REINSTATE'),
          suspendedAt: null,
          suspendedBy: null,
          suspensionReason: null,
        },
        tx,
      );
      await this.quests.audit(
        {
          questId,
          actorId: staff.accountId,
          eventType: 'QUEST_REINSTATED',
          metadata: { liftedReason: quest.suspensionReason ?? '' },
        },
        tx,
      );
      return quest;
    });
    this.metrics.increment('quest.core.reinstated');
    await this.publishEvent(
      createEvent(
        QuestReinstated,
        { questId, ownerAccountId: record.ownerAccountId, byStaffAccountId: staff.accountId },
        this.opts(questId, staff.accountId),
      ),
    );
    return this.supportView(questId);
  }

  async supportView(questId: string): Promise<QuestSupportView> {
    const quest = await this.quests.findById(questId);
    if (!quest) throw ApiError.notFound('Quest');
    const [assessments, participationCount] = await Promise.all([
      this.quests.listAssessments(questId, SUPPORT_ASSESSMENT_LIMIT),
      this.participations.countForQuest(questId),
    ]);
    return {
      questId: quest.id,
      ownerAccountId: quest.ownerAccountId,
      state: quest.state,
      visibility: quest.visibility,
      title: quest.title,
      revision: quest.revision,
      contentHash: quest.contentHash,
      publishedContentHash: quest.publishedContentHash,
      publishedAt: quest.publishedAt?.toISOString() ?? null,
      suspendedAt: quest.suspendedAt?.toISOString() ?? null,
      suspensionReason: quest.suspensionReason,
      participationCount,
      assessments: assessments.map((a) => this.toAssessmentView(a, quest.contentHash)),
    };
  }

  // ------------------------------------------------------------------------------- helpers ----

  /** Publish blockers for the owner's own view, without attempting to publish. */
  async publishBlockers(quest: QuestRecord, principal: Principal): Promise<string[]> {
    // A Quest that is already published has nothing blocking its publication. Reporting
    // `INVALID_STATE_PUBLISHED` here would tell the owner to fix something that is not wrong.
    if (quest.state === QuestState.PUBLISHED && quest.publishedContentHash === quest.contentHash) {
      return [];
    }
    const [owner, assessment] = await Promise.all([
      this.owners.factsFor(principal.accountId),
      this.quests.latestAssessment(quest.id),
    ]);
    const eligibility = questEligibilitySchema.parse(quest.eligibility);
    return evaluatePublish({
      quest,
      latestAssessment: assessment ?? null,
      declaredMinimumAgeBand: eligibility.minimumAgeBand,
      owner,
      actorAccountId: principal.accountId,
      expectedContentHash: quest.contentHash,
      maxAssessmentAgeMs: this.config.QUEST_ASSESSMENT_MAX_AGE_DAYS * DAY_MS,
      now: new Date(),
    }).blockers;
  }

  latestAssessmentFor(questId: string): Promise<AssessmentRecord | undefined> {
    return this.quests.latestAssessment(questId);
  }

  contentOf(quest: QuestRecord): QuestContent {
    return questContentSchema.parse({
      title: quest.title,
      summary: quest.summary,
      instructions: quest.instructions,
      safetyNotes: quest.safetyNotes ?? undefined,
      categoryKey: quest.categoryKey,
      difficulty: quest.difficulty,
      evidence: quest.evidence,
      eligibility: quest.eligibility,
      location: quest.locationCountryCode
        ? { countryCode: quest.locationCountryCode, label: quest.locationLabel ?? undefined }
        : undefined,
    });
  }

  eligibilityOf(quest: QuestRecord): QuestEligibility {
    return questEligibilitySchema.parse(quest.eligibility);
  }

  publishedAgeBandOf(quest: QuestRecord): QuestAgeBand {
    return (quest.publishedMinimumAgeBand ??
      this.eligibilityOf(quest).minimumAgeBand) as QuestAgeBand;
  }

  toAssessmentView(record: AssessmentRecord, currentContentHash: string): QuestAssessmentView {
    const rule = canPublishWithAssessment(
      {
        assessmentId: record.id,
        subjectType: 'QUEST',
        subjectId: record.questId,
        subjectContentVersion: record.contentHash,
        state: record.state,
        signals: record.signals,
        restrictions: record.restrictions,
        policyVersion: record.policyVersion,
        decidedBy: record.decidedBy,
        assessedAt: record.assessedAt.toISOString(),
      },
      currentContentHash,
    );
    return {
      assessmentId: record.id,
      questId: record.questId,
      contentHash: record.contentHash,
      state: record.state,
      categories: record.signals.map((s) => s.category),
      policyVersion: record.policyVersion,
      decidedBy: record.decidedBy,
      assessedAt: record.assessedAt.toISOString(),
      publishable: rule.allowed,
      reason: rule.reason,
    };
  }

  /**
   * Effective eligibility: the owner's declared rules folded with the *published* assessment's
   * restrictions. Publication proof is what governs a live Quest, so the restrictions come from
   * the assessment the Quest actually published with, not from whatever was assessed last.
   */
  async effectiveEligibilityOf(quest: QuestRecord): Promise<QuestEligibility> {
    const declared = this.eligibilityOf(quest);
    if (!quest.publishedAssessmentId) return declared;
    const assessment = await this.quests.findAssessmentById(quest.publishedAssessmentId);
    return { ...declared, ...effectiveCountryRules(declared, assessment ?? null) };
  }

  /**
   * Cancels every in-flight attempt on a Quest that is leaving visibility, and returns the rows so
   * the caller can announce them after the transaction commits. Cancelling hundreds of people's
   * attempts with no event and no ledger entry left participants with no possible notification
   * and left the ledger claiming nothing happened (P02-18).
   */
  private async withdrawParticipations(
    questId: string,
    tx: Parameters<typeof this.quests.findByIdForUpdate>[1],
  ): Promise<ParticipationRecord[]> {
    const cancelled = await this.participations.cancelActiveForQuest(
      questId,
      'QUEST_WITHDRAWN',
      tx,
    );
    for (const row of cancelled) {
      await this.quests.audit(
        {
          questId,
          actorId: null,
          eventType: 'PARTICIPATION_CANCELLED',
          metadata: { participationId: row.id, reason: 'QUEST_WITHDRAWN' },
        },
        tx,
      );
    }
    return cancelled;
  }

  /** Publishes one cancellation event per withdrawn attempt, after the transaction commits. */
  private async announceCancellations(
    questId: string,
    actorId: string,
    cancelled: ParticipationRecord[],
  ): Promise<void> {
    if (cancelled.length === 0) return;
    this.metrics.increment('quest.participation.cancelled', cancelled.length, {
      reason: 'QUEST_WITHDRAWN',
    });
    for (const row of cancelled) {
      await this.publishEvent(
        createEvent(
          QuestParticipationCancelled,
          {
            participationId: row.id,
            questId,
            accountId: row.accountId,
            questVersion: row.questVersion,
            reason: 'QUEST_WITHDRAWN',
          },
          { ...this.opts(questId, actorId), aggregateId: row.id },
        ),
      );
    }
  }

  /** Announces that a Quest's content was destroyed (owner account erasure). */
  async announceErasure(quest: QuestRecord, cancelled: ParticipationRecord[]): Promise<void> {
    await this.publishEvent(
      createEvent(
        QuestErased,
        { questId: quest.id, ownerAccountId: quest.ownerAccountId },
        { ...this.opts(quest.id, quest.ownerAccountId) },
      ),
    );
    await this.publishEvent(
      createEvent(
        QuestUnpublished,
        {
          questId: quest.id,
          ownerAccountId: quest.ownerAccountId,
          reason: 'ERASED',
          state: QuestState.ERASED,
        },
        this.opts(quest.id, quest.ownerAccountId),
      ),
    );
    await this.announceCancellations(quest.id, quest.ownerAccountId, cancelled);
  }

  private async assertCategory(key: string): Promise<void> {
    if (!(await this.quests.categoryExists(key))) {
      throw ApiError.validation([{ path: 'content.categoryKey', message: 'Unknown category' }]);
    }
  }

  /** Reads a Quest the principal owns, or 404 — never 403, which would confirm existence. */
  private async requireOwned(questId: string, principal: Principal): Promise<QuestRecord> {
    const quest = await this.quests.findById(questId);
    if (!quest || quest.ownerAccountId !== principal.accountId || quest.state === QuestState.ERASED)
      throw ApiError.notFound('Quest');
    return quest;
  }

  private async lockOwned(
    questId: string,
    principal: Principal,
    tx: Parameters<typeof this.quests.findByIdForUpdate>[1],
  ): Promise<QuestRecord> {
    const quest = await this.quests.findByIdForUpdate(questId, tx);
    if (!quest || quest.ownerAccountId !== principal.accountId || quest.state === QuestState.ERASED)
      throw ApiError.notFound('Quest');
    return quest;
  }

  private opts(questId: string, actorId: string) {
    return {
      aggregateId: questId,
      correlationId: getRequestContext()?.correlationId ?? uuidv7(),
      source: SOURCE,
      actorId,
    };
  }

  private async publishEvent(event: Parameters<EventPublisher['publish']>[0]): Promise<void> {
    // Published after the transaction commits: a consumer must never see an event for state that
    // was rolled back (Phase 01 convention, docs/architecture/06_EVENT_ARCHITECTURE.md).
    await this.events.publish(event);
  }
}

/** The Trust & Safety contract shape of a stored assessment row. */
export function toSharedAssessment(record: AssessmentRecord): SafetyAssessment {
  return {
    assessmentId: record.id,
    subjectType: 'QUEST',
    subjectId: record.questId,
    subjectContentVersion: record.contentHash,
    state: record.state,
    signals: record.signals,
    restrictions: record.restrictions,
    policyVersion: record.policyVersion,
    decidedBy: record.decidedBy,
    assessedAt: record.assessedAt.toISOString(),
  };
}

function contentColumns(content: QuestContent) {
  return {
    title: content.title,
    summary: content.summary,
    instructions: content.instructions,
    safetyNotes: content.safetyNotes ?? null,
    categoryKey: content.categoryKey,
    difficulty: content.difficulty,
    evidence: content.evidence,
    eligibility: content.eligibility,
    locationCountryCode: content.location?.countryCode ?? null,
    locationLabel: content.location?.label ?? null,
  };
}

function durationColumns(duration: QuestDuration) {
  return {
    effortMinutes: duration.effortMinutes,
    completionWindowHours: duration.completionWindowHours,
    availableFrom: duration.availableFrom ? new Date(duration.availableFrom) : null,
    availableUntil: duration.availableUntil ? new Date(duration.availableUntil) : null,
  };
}

export function durationOf(quest: QuestRecord): QuestDuration {
  return {
    effortMinutes: quest.effortMinutes,
    completionWindowHours: quest.completionWindowHours,
    availableFrom: quest.availableFrom?.toISOString(),
    availableUntil: quest.availableUntil?.toISOString(),
  };
}
