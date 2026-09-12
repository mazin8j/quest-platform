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
import { METRICS, type MetricsPort } from '../../../common/observability/metrics.port';
import { OWNER_ELIGIBILITY, type OwnerEligibilityPort } from '../../identity';
import { BLOCK_QUERY, PROFILE_QUERY } from '../../profiles';
import type { BlockQueryPort, ProfileQueryPort } from '../../profiles';
import {
  type OwnerEligible,
  QuestAccess,
  type ViewerContext,
  publishedAgeBand,
  questAccessFor,
  visibleAgeBandsFor,
} from '../domain/eligibility';
import { effectiveAssessment, publishedDecisionPublishable } from '../domain/safety-precedence';
import type { AssessmentRecord, QuestRecord } from '../domain/quest';
import { ParticipationRepository } from '../infrastructure/participation.repository';
import { QuestRepository } from '../infrastructure/quest.repository';
import { QuestService, durationOf } from './quest.service';

/**
 * Upper bound on extra database round trips while refilling a page past rows the viewer may not
 * see. Exported so the integration suite can state its N+1 bound in terms of the real constant
 * rather than a copy of it.
 *
 * The bound is a real protection — without it one request could scan the whole table — so the fix
 * for P1-1 keeps it and changes what happens when it is reached: the scan position is handed back
 * instead of discarded, and the caller continues from there on the next request.
 */
export const MAX_DISCOVERY_PASSES = 5;

/**
 * The result of one discovery scan: the cards that survived filtering, how far the underlying
 * keyset scan actually got, and whether it stopped because the table ran out.
 *
 * The distinction is the whole of the P1-1 fix. Filtering happens after the query — owner
 * eligibility, safety decisions and blocks are not columns — so a page can come back short, or
 * empty, while rows remain. Reporting that as end-of-feed made the catalogue behind a run of
 * concealed rows unreachable for every viewer.
 */
export interface DiscoveryScan {
  rows: Array<QuestCard & { cursorAt: Date }>;
  /** Last row the scan examined, survivor or not. `null` when nothing was read. */
  scannedThrough: { createdAt: Date; id: string } | null;
  /** True only when the database had no more rows to give. */
  exhausted: boolean;
}

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
    @Inject(OWNER_ELIGIBILITY) private readonly ownerEligibility: OwnerEligibilityPort,
    @Inject(METRICS) private readonly metrics: MetricsPort,
    private readonly quests: QuestRepository,
    private readonly participations: ParticipationRepository,
    private readonly questService: QuestService,
  ) {}

  /**
   * Whether one Quest's owner may currently have public content.
   *
   * A lookup that throws is not an answer, and an unanswered question is not permission: the
   * failure is counted so it is visible to operators, and reported as ineligible so the Quest is
   * concealed rather than disclosed on the strength of a broken dependency (audit P02-41).
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
   * The same question for a page of Quests, in one Identity query rather than one per row.
   *
   * Absent from the returned map means ineligible (the port's contract), and a failed lookup
   * conceals the whole page for the same reason the single-Quest path conceals one.
   */
  private async ownerEligibilityFor(ownerAccountIds: string[]): Promise<Map<string, boolean>> {
    if (ownerAccountIds.length === 0) return new Map();
    try {
      return await this.ownerEligibility.publicationEligibilityFor(ownerAccountIds);
    } catch {
      this.metrics.increment('quest.core.owner_eligibility_unavailable');
      return new Map();
    }
  }

  /**
   * The safety decision in force for one Quest's published content, as a gate value.
   *
   * A failed lookup conceals, for the same reason a failed eligibility lookup does: the question
   * "may this content be public" has no safe default answer other than no.
   */
  private async safetyGateFor(quest: QuestRecord): Promise<boolean | null> {
    if (quest.state !== 'PUBLISHED' || quest.publishedContentHash === null) return null;
    try {
      const rows = await this.quests.assessmentsForContent(quest.id, quest.publishedContentHash);
      return publishedDecisionPublishable(quest, rows);
    } catch {
      this.metrics.increment('quest.core.safety_decision_unavailable');
      return false;
    }
  }

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
    const [viewer, ownerEligible, safetyPublishable, decisions] = await Promise.all([
      this.viewerContextFor(principal, quest.ownerAccountId),
      // Asked unconditionally rather than only for unprivileged callers: `questAccessFor` decides
      // that the owner and support see the Quest whatever the answer is, and making this call
      // depend on that ordering would turn a future reordering of the rule into a disclosure.
      this.ownerEligible(quest.ownerAccountId),
      this.safetyGateFor(quest),
      this.quests.assessmentsForContent(questId, quest.publishedContentHash ?? quest.contentHash),
    ]);
    const access = questAccessFor(quest, viewer, { ownerEligible, safetyPublishable });
    // 404, not 403: the concealment must not distinguish "this Quest is gone" from "this Quest's
    // author is suspended", and must say nothing about the account behind it (audit P02-41).
    if (access === QuestAccess.HIDDEN) throw ApiError.notFound('Quest');

    const isOwner = viewer.accountId === quest.ownerAccountId;
    const [owner, participating] = await Promise.all([
      this.ownerCard(quest.ownerAccountId, viewer.accountId),
      viewer.accountId
        ? this.participations.findActive(questId, viewer.accountId).then((p) => p !== undefined)
        : Promise.resolve(false),
    ]);
    // The badge shows the decision **in force** — the same one the gate above consulted — so the
    // response can never say "REJECTED" while granting access (final delta audit P1-3).
    const assessment = effectiveAssessment(
      decisions,
      quest.publishedContentHash ?? quest.contentHash,
    );

    const evidence = evidenceRequirementSchema.parse(quest.evidence);
    return {
      ...this.core(quest, owner),
      instructions: quest.instructions,
      safetyNotes: quest.safetyNotes,
      evidence,
      safety: this.safetyBadge(quest, assessment),
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
   *
   * Owner-eligibility filtering rides on the same refill loop for the same reason, and is resolved
   * with ONE batched Identity query per pass rather than one per row: a feed that asked Identity
   * about every card would make account state an N+1 on the hottest read in the product
   * (audit P02-41). Because the survivors are counted inside the loop, dropping an ineligible
   * owner's Quests shortens the underlying read, never the page the caller receives.
   */
  async listDiscoverable(
    principal: Principal | null,
    filter: { categoryKey?: string; difficulty?: string },
    page: { limit: number; cursor?: { createdAt: Date; id: string } },
  ): Promise<DiscoveryScan> {
    const viewerBand = principal?.ageBand === 'UNDER_MINIMUM' ? null : (principal?.ageBand ?? null);
    const query = { ...filter, now: new Date(), ageBands: visibleAgeBandsFor(viewerBand) };
    const visible: QuestRecord[] = [];
    const decisions = new Map<string, AssessmentRecord[]>();
    let cursor = page.cursor;
    // `exhausted` means the database ran out of rows, which is the only honest reason to tell a
    // client there is no more. Exiting on the pass bound is "I stopped scanning", and the two must
    // not look alike to the caller (final delta audit P1-1).
    let exhausted = false;
    for (let pass = 0; pass < MAX_DISCOVERY_PASSES && visible.length < page.limit; pass += 1) {
      const rows = await this.quests.listDiscoverable(query, { limit: page.limit, cursor });
      if (rows.length === 0) {
        exhausted = true;
        break;
      }
      const [eligibleOwners, pageDecisions] = await Promise.all([
        this.ownerEligibilityFor([...new Set(rows.map((r) => r.ownerAccountId))]),
        this.safetyDecisionsFor(rows.map((r) => r.id)),
      ]);
      for (const quest of rows) {
        // Absence means ineligible: an owner id Identity did not resolve is concealed, not shown.
        if (eligibleOwners.get(quest.ownerAccountId) !== true) continue;
        // The safety decision in force for the published content, batched with the page rather
        // than fetched per row (P1-3 enforced without reintroducing the P02-41 N+1).
        const rowDecisions = pageDecisions.get(quest.id) ?? [];
        if (publishedDecisionPublishable(quest, rowDecisions) === false) continue;
        // Block precedence: a Quest by a blocked owner is not in the list at all.
        const blocked =
          !principal || quest.ownerAccountId === principal.accountId
            ? false
            : await this.blocks.isBlockedEitherWay(principal.accountId, quest.ownerAccountId);
        if (blocked) continue;
        visible.push(quest);
        decisions.set(quest.id, rowDecisions);
      }
      const last = rows[rows.length - 1];
      // Fewer rows than asked for means the keyset reached the end of the table.
      if (!last || rows.length < page.limit) {
        exhausted = true;
        break;
      }
      cursor = { createdAt: last.createdAt, id: last.id };
    }
    return {
      rows: await this.toCards(visible, principal?.accountId ?? null, decisions),
      // Where the scan actually got to, which is ahead of the last surviving row whenever rows were
      // concealed. Handing back a survivor's cursor instead would re-read the concealed run on
      // every subsequent request and never make progress.
      scannedThrough: cursor ?? null,
      exhausted,
    };
  }

  /**
   * Every decision about the effective content of a page of Quests, in one query. A failure
   * conceals the whole page: an empty map makes `publishedDecisionPublishable` return `false` for
   * every published row, which is the fail-closed direction.
   */
  private async safetyDecisionsFor(questIds: string[]): Promise<Map<string, AssessmentRecord[]>> {
    if (questIds.length === 0) return new Map();
    try {
      return await this.quests.assessmentsForEffectiveContent(questIds);
    } catch {
      this.metrics.increment('quest.core.safety_decision_unavailable');
      return new Map();
    }
  }

  private async toCards(
    rows: QuestRecord[],
    viewerAccountId: string | null,
    /**
     * Decisions already fetched by the caller, keyed by Quest id. Passed in rather than re-queried
     * so a card's badge is the same decision the access gate consulted — a badge that can disagree
     * with the access granted is the defect, not a display detail (final delta audit P1-3).
     */
    decisions?: Map<string, AssessmentRecord[]>,
  ): Promise<Array<QuestCard & { cursorAt: Date }>> {
    if (rows.length === 0) return [];
    const [owners, fetched, active] = await Promise.all([
      this.profiles.publicCardsFor(
        [...new Set(rows.map((r) => r.ownerAccountId))],
        viewerAccountId,
      ),
      decisions
        ? Promise.resolve(decisions)
        : this.quests.assessmentsForEffectiveContent(rows.map((r) => r.id)),
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
      safety: this.safetyBadge(
        quest,
        effectiveAssessment(
          fetched.get(quest.id) ?? [],
          quest.publishedContentHash ?? quest.contentHash,
        ),
      ),
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
