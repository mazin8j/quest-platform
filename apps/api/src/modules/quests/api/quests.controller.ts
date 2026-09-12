import { Body, Controller, Get, HttpCode, Param, Post, Put, Query, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  type ArchiveQuestRequest,
  type CreateQuestRequest,
  Permission,
  type QuestAssessmentView,
  type QuestDetail,
  type QuestList,
  type UpdateQuestRequest,
  archiveQuestRequestSchema,
  createQuestRequestSchema,
  publishQuestRequestSchema,
  questListQuerySchema,
  updateQuestRequestSchema,
  uuidSchema,
} from '@quest/types';

import type { Request } from 'express';

import {
  CurrentPrincipal,
  Public,
  RequirePermission,
  RequireVerifiedEmail,
  principalFromRequest,
} from '../../../common/auth/decorators';
import type { Principal } from '../../../common/auth/principal';
import {
  type ListPageQuery,
  decodeCursor,
  listPageQuerySchema,
  toPage,
  toScannedPage,
} from '../../../common/pagination/cursor-page';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { QuestService } from '../application/quest.service';
import { QuestViewService } from '../application/quest-view.service';
import { QuestRepository } from '../infrastructure/quest.repository';

/** Authoring and reading Quests. Ownership always comes from the principal, never from a body. */
@Controller({ path: 'quests', version: '1' })
export class QuestsController {
  constructor(
    private readonly quests: QuestService,
    private readonly views: QuestViewService,
    private readonly repo: QuestRepository,
  ) {}

  @Post()
  @RequirePermission(Permission.MANAGE_OWN_QUESTS)
  @RequireVerifiedEmail()
  @Throttle({ global: { limit: 20, ttl: 60_000 } })
  async create(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodValidationPipe(createQuestRequestSchema)) body: CreateQuestRequest,
  ): Promise<QuestDetail> {
    const record = await this.quests.create(principal, body);
    return this.views.detail(record.id, principal);
  }

  /** Discovery list: published, public, unranked (newest first). Available to signed-out callers. */
  @Get()
  @Public()
  @Throttle({ global: { limit: 60, ttl: 60_000 } })
  async list(
    @Query(new ZodValidationPipe(questListQuerySchema))
    query: { categoryKey?: string; difficulty?: string; cursor?: string; limit: number },
    @Req() req: Request,
  ): Promise<QuestList> {
    // `@Public` still resolves a bearer token when one is present: a signed-in caller gets block
    // filtering and a participation badge, an anonymous one gets the plain public list.
    const principal = principalFromRequest(req) ?? null;
    const cursor = decodeCursor(query.cursor);
    const scan = await this.views.listDiscoverable(
      principal,
      { categoryKey: query.categoryKey, difficulty: query.difficulty },
      {
        limit: query.limit + 1,
        cursor: cursor ? { createdAt: cursor.at, id: cursor.id } : undefined,
      },
    );
    // `toScannedPage`, not `toPage`: a short page here can mean "rows were concealed", and only the
    // scan knows whether the database actually ran out (final delta audit P1-1).
    return toScannedPage(
      {
        rows: scan.rows,
        scannedThrough: scan.scannedThrough
          ? { at: scan.scannedThrough.createdAt, id: scan.scannedThrough.id }
          : null,
        exhausted: scan.exhausted,
      },
      query.limit,
      (row) => ({ at: row.cursorAt, id: row.questId }),
    );
  }

  /** The caller's own Quests, in every state. */
  @Get('mine')
  @RequirePermission(Permission.MANAGE_OWN_QUESTS)
  async mine(
    @CurrentPrincipal() principal: Principal,
    @Query(new ZodValidationPipe(listPageQuerySchema)) query: ListPageQuery,
  ): Promise<QuestList> {
    const cursor = decodeCursor(query.cursor);
    const rows = await this.views.listOwned(principal, {
      limit: query.limit + 1,
      cursor: cursor ? { createdAt: cursor.at, id: cursor.id } : undefined,
    });
    return toPage(rows, query.limit, (row) => ({ at: row.cursorAt, id: row.questId }));
  }

  @Get(':questId')
  @Public()
  @Throttle({ global: { limit: 60, ttl: 60_000 } })
  detail(
    @Param('questId', new ZodValidationPipe(uuidSchema)) questId: string,
    @Req() req: Request,
  ): Promise<QuestDetail> {
    return this.views.detail(questId, principalFromRequest(req) ?? null);
  }

  @Put(':questId')
  @RequirePermission(Permission.MANAGE_OWN_QUESTS)
  @Throttle({ global: { limit: 30, ttl: 60_000 } })
  async update(
    @CurrentPrincipal() principal: Principal,
    @Param('questId', new ZodValidationPipe(uuidSchema)) questId: string,
    @Body(new ZodValidationPipe(updateQuestRequestSchema)) body: UpdateQuestRequest,
  ): Promise<QuestDetail> {
    await this.quests.update(principal, questId, body);
    return this.views.detail(questId, principal);
  }

  /** Requests a safety decision for the current content. Never publishes by itself. */
  @Post(':questId/assessment')
  @RequirePermission(Permission.MANAGE_OWN_QUESTS)
  @HttpCode(200)
  @Throttle({ global: { limit: 10, ttl: 60_000 } })
  assess(
    @CurrentPrincipal() principal: Principal,
    @Param('questId', new ZodValidationPipe(uuidSchema)) questId: string,
  ): Promise<QuestAssessmentView> {
    return this.quests.assess(principal, questId);
  }

  /** The only path to visibility; fails closed with machine-readable blockers. */
  @Post(':questId/publish')
  @RequirePermission(Permission.MANAGE_OWN_QUESTS)
  @RequireVerifiedEmail()
  @HttpCode(200)
  @Throttle({ global: { limit: 10, ttl: 60_000 } })
  async publish(
    @CurrentPrincipal() principal: Principal,
    @Param('questId', new ZodValidationPipe(uuidSchema)) questId: string,
    @Body(new ZodValidationPipe(publishQuestRequestSchema)) body: { expectedContentHash: string },
  ): Promise<QuestDetail> {
    await this.quests.publish(principal, questId, body.expectedContentHash);
    return this.views.detail(questId, principal);
  }

  @Post(':questId/archive')
  @RequirePermission(Permission.MANAGE_OWN_QUESTS)
  @HttpCode(200)
  async archive(
    @CurrentPrincipal() principal: Principal,
    @Param('questId', new ZodValidationPipe(uuidSchema)) questId: string,
    @Body(new ZodValidationPipe(archiveQuestRequestSchema)) body: ArchiveQuestRequest,
  ): Promise<QuestDetail> {
    await this.quests.archive(principal, questId, body.reason);
    return this.views.detail(questId, principal);
  }
}

/** The category catalogue: static reference data, safe for anonymous callers. */
@Controller({ path: 'quest-categories', version: '1' })
export class QuestCategoriesController {
  constructor(private readonly repo: QuestRepository) {}

  @Get()
  @Public()
  @Throttle({ global: { limit: 60, ttl: 60_000 } })
  async list(): Promise<{ data: Array<{ key: string; label: string; sortOrder: number }> }> {
    return { data: await this.repo.activeCategories() };
  }
}
