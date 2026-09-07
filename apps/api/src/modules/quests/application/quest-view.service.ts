import { Inject, Injectable } from '@nestjs/common';
import {
  Permission,
  type QuestCard,
  type QuestDetail,
  type QuestSafetyBadge,
  evidenceRequirementSchema,
  hasPermission,
} from '@quest/types';

import type { Principal } from '../../../common/auth/principal';
import { ApiError } from '../../../common/filters/api-error';
import { BLOCK_QUERY, PROFILE_QUERY } from '../../profiles';
import type { BlockQueryPort, ProfileQueryPort } from '../../profiles';
import {
  QuestAccess,
  type ViewerContext,
  publishedAgeBand,
  questAccessFor,
  visibleAgeBandsFor,
} from '../domain/eligibility';
import type { AssessmentRecord, QuestRecord } from '../domain/quest';
import { ParticipationRepository } from '../infrastructure/participation.repository';
import { QuestRepository } from '../infrastructure/quest.repository';
import { QuestService, durationOf } from './quest.service';

/** Upper bound on extra database round trips while refilling a page past blocked owners. */
const MAX_DISCOVERY_PASSES = 5;

/**
 * Read side: turns Quest rows into the views each audience is allowed to see.
 *
 * The rules live here rather than in the controllers so there is one place to check what leaves
 * the context: an owner sees their own integrity fields, a viewer sees the published Quest, a
 * blocked or unauthorised caller sees a 404, and nobody ever sees another account's email, date of
 * birth or exact location.
 */
@Injectable()
export class QuestViewService {
  constructor(
    @Inject(BLOCK_QUERY) private readonly blocks: BlockQueryPort,
    @Inject(PROFILE_QUERY) private readonly profiles: ProfileQueryPort,
    private readonly quests: QuestRepository,
    private readonly participations: ParticipationRepository,
    private readonly questService: QuestService,
  ) {}

  async viewerContextFor(
    principal: Principal | null,
    ownerAccountId: string,
  ): Promise<ViewerContext> {
    if (!principal) {
      return {
        accountId: null,
        ageBand: null,
        emailVerified: false,
        countryCode: null,
        canViewSupport: false,
        blocked: false,
      };
    }
    const [blocked, countryCode] = await Promise.all([
      principal.accountId === ownerAccountId
        ? Promise.resolve(false)
        : this.blocks.isBlockedEitherWay(principal.accountId, ownerAccountId),
      this.profiles.countryFor(principal.accountId),
    ]);
    return {
      accountId: principal.accountId,
      ageBand: principal.ageBand === 'UNDER_MINIMUM' ? null : principal.ageBand,
      emailVerified: principal.emailVerified,
      countryCode,
      // The permission the RBAC matrix actually grants, not "has any staff role": an ANALYST or
      // READ_ONLY account is staff and has no business reading an unpublished Quest (P02-05).
      canViewSupport: hasPermission(principal.roles, Permission.VIEW_QUEST_SUPPORT),
      blocked,
    };
  }

  /** Detail for one Quest, or NOT FOUND when the caller may not know it exists. */
  async detail(questId: string, principal: Principal | null): Promise<QuestDetail> {
    const quest = await this.quests.findById(questId);
    if (!quest || quest.state === 'ERASED') throw ApiError.notFound('Quest');
    const viewer = await this.viewerContextFor(principal, quest.ownerAccountId);
    const access = questAccessFor(quest, viewer);
    if (access === QuestAccess.HIDDEN) throw ApiError.notFound('Quest');

    const isOwner = viewer.accountId === quest.ownerAccountId;
    const [owner, assessment, participating] = await Promise.all([
      this.ownerCard(quest.ownerAccountId, viewer.accountId),
      this.quests.latestAssessment(questId),
      viewer.accountId
        ? this.participations.findActive(questId, viewer.accountId).then((p) => p !== undefined)
        : Promise.resolve(false),
    ]);

    const evidence = evidenceRequirementSchema.parse(quest.evidence);
    return {
      ...this.core(quest, owner),
      instructions: quest.instructions,
      safetyNotes: quest.safetyNotes,
      evidence,
      safety: this.safetyBadge(quest, assessment ?? null),
      participating,
      contentHash: isOwner ? quest.contentHash : null,
      publishedContentHash: isOwner ? quest.publishedContentHash : null,
      publishBlockers:
        isOwner && principal ? await this.questService.publishBlockers(quest, principal) : null,
    };
  }

  /** Owner's own Quests (all states). */
  async listOwned(
    principal: Principal,
    page: { limit: number; cursor?: { createdAt: Date; id: string } },
  ): Promise<Array<QuestCard & { cursorAt: Date }>> {
    const rows = await this.quests.listOwned(principal.accountId, page);
    return this.toCards(rows, principal.accountId);
  }

  /**
   * Discovery: published, public Quests, newest first. Deliberately unranked — recommendation and
   * ranking are later phases and must not appear here.
   *
   * Block filtering happens after the query, so the page is refilled until it holds `limit + 1`
   * survivors or the underlying rows run out. Filtering a fixed `limit + 1` fetch and letting
   * `toPage` read `hasMore` off the shortened array ended the feed early and made the rest of the
   * catalogue unreachable through the API (audit P02-19).
   */
  async listDiscoverable(
    principal: Principal | null,
    filter: { categoryKey?: string; difficulty?: string },
    page: { limit: number; cursor?: { createdAt: Date; id: string } },
  ): Promise<Array<QuestCard & { cursorAt: Date }>> {
    const viewerBand = principal?.ageBand === 'UNDER_MINIMUM' ? null : (principal?.ageBand ?? null);
    const query = { ...filter, now: new Date(), ageBands: visibleAgeBandsFor(viewerBand) };
    const visible: QuestRecord[] = [];
    let cursor = page.cursor;
    for (let pass = 0; pass < MAX_DISCOVERY_PASSES && visible.length < page.limit; pass += 1) {
      const rows = await this.quests.listDiscoverable(query, { limit: page.limit, cursor });
      if (rows.length === 0) break;
      for (const quest of rows) {
        // Block precedence: a Quest by a blocked owner is not in the list at all.
        const blocked =
          !principal || quest.ownerAccountId === principal.accountId
            ? false
            : await this.blocks.isBlockedEitherWay(principal.accountId, quest.ownerAccountId);
        if (!blocked) visible.push(quest);
      }
      const last = rows[rows.length - 1];
      if (!last || rows.length < page.limit) break;
      cursor = { createdAt: last.createdAt, id: last.id };
    }
    return this.toCards(visible, principal?.accountId ?? null);
  }

  private async toCards(
    rows: QuestRecord[],
    viewerAccountId: string | null,
  ): Promise<Array<QuestCard & { cursorAt: Date }>> {
    if (rows.length === 0) return [];
    const [owners, assessments, active] = await Promise.all([
      this.profiles.publicCardsFor(
        [...new Set(rows.map((r) => r.ownerAccountId))],
        viewerAccountId,
      ),
      this.quests.latestAssessmentsFor(rows.map((r) => r.id)),
      viewerAccountId
        ? this.participations.activeQuestIds(
            viewerAccountId,
            rows.map((r) => r.id),
          )
        : Promise.resolve(new Set<string>()),
    ]);
    return rows.map((quest) => ({
      ...this.core(quest, {
        accountId: quest.ownerAccountId,
        username: owners[quest.ownerAccountId]?.username ?? null,
        displayName: owners[quest.ownerAccountId]?.displayName ?? null,
      }),
      safety: this.safetyBadge(quest, assessments.get(quest.id) ?? null),
      participating: active.has(quest.id),
      cursorAt: quest.createdAt,
    }));
  }

  private async ownerCard(accountId: string, viewerAccountId: string | null) {
    const cards = await this.profiles.publicCardsFor([accountId], viewerAccountId);
    return {
      accountId,
      username: cards[accountId]?.username ?? null,
      displayName: cards[accountId]?.displayName ?? null,
    };
  }

  private core(quest: QuestRecord, owner: QuestCard['owner']) {
    const declared = this.questService.eligibilityOf(quest);
    const published = publishedAgeBand(quest);
    return {
      questId: quest.id,
      state: quest.state,
      visibility: quest.visibility,
      revision: quest.revision,
      publishedVersion: quest.publishedVersion,
      title: quest.title,
      summary: quest.summary,
      categoryKey: quest.categoryKey as QuestCard['categoryKey'],
      difficulty: quest.difficulty as QuestCard['difficulty'],
      duration: durationOf(quest),
      // The band that is actually enforced. A safety decision can tighten it above what the owner
      // declared, and advertising the looser draft value showed a client an accept affordance for
      // an adults-only Quest (audit P02-29).
      eligibility: published ? { ...declared, minimumAgeBand: published } : declared,
      location: quest.locationCountryCode
        ? { countryCode: quest.locationCountryCode, label: quest.locationLabel ?? undefined }
        : null,
      owner,
      createdAt: quest.createdAt.toISOString(),
      updatedAt: quest.updatedAt.toISOString(),
      publishedAt: quest.publishedAt?.toISOString() ?? null,
    };
  }

  /**
   * What a participant is told about safety. Only a decision that matches the *published* content
   * is ever shown: a newer assessment of edited draft content says nothing about what is public.
   */
  private safetyBadge(
    quest: QuestRecord,
    assessment: AssessmentRecord | null,
  ): QuestSafetyBadge | null {
    if (!assessment) return null;
    const relevantHash = quest.publishedContentHash ?? quest.contentHash;
    if (assessment.contentHash !== relevantHash) return null;
    return {
      state: assessment.state,
      warning: assessment.restrictions?.requiresWarningText ?? null,
      minimumAgeBand: this.questService.publishedAgeBandOf(quest),
      policyVersion: assessment.policyVersion,
      assessedAt: assessment.assessedAt.toISOString(),
    };
  }
}
