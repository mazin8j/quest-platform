import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  type AcceptQuestRequest,
  type CompletionRequest,
  type ParticipationList,
  type ParticipationView,
  Permission,
  acceptQuestRequestSchema,
  completionRequestSchema,
  uuidSchema,
} from '@quest/types';

import { CurrentPrincipal, RequirePermission } from '../../../common/auth/decorators';
import type { Principal } from '../../../common/auth/principal';
import {
  type ListPageQuery,
  decodeCursor,
  listPageQuerySchema,
  toPage,
} from '../../../common/pagination/cursor-page';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { ParticipationService } from '../application/participation.service';

/** Accepting a Quest. Separate from the Quest resource because the participant owns this record. */
@Controller({ path: 'quests/:questId/participation', version: '1' })
export class QuestParticipationController {
  constructor(private readonly participations: ParticipationService) {}

  @Post()
  @RequirePermission(Permission.PARTICIPATE_IN_QUESTS)
  @Throttle({ global: { limit: 30, ttl: 60_000 } })
  accept(
    @CurrentPrincipal() principal: Principal,
    @Param('questId', new ZodValidationPipe(uuidSchema)) questId: string,
    @Body(new ZodValidationPipe(acceptQuestRequestSchema)) body: AcceptQuestRequest,
  ): Promise<ParticipationView> {
    return this.participations.accept(principal, questId, body.expectedPublishedVersion);
  }
}

/** The participant's own attempts. */
@Controller({ path: 'me/participations', version: '1' })
export class ParticipationsController {
  constructor(private readonly participations: ParticipationService) {}

  @Get()
  @RequirePermission(Permission.PARTICIPATE_IN_QUESTS)
  async list(
    @CurrentPrincipal() principal: Principal,
    @Query(new ZodValidationPipe(listPageQuerySchema)) query: ListPageQuery,
  ): Promise<ParticipationList> {
    const cursor = decodeCursor(query.cursor);
    const rows = await this.participations.list(principal, {
      limit: query.limit + 1,
      cursor: cursor ? { acceptedAt: cursor.at, id: cursor.id } : undefined,
    });
    return toPage(rows, query.limit, (row) => ({ at: row.cursorAt, id: row.participationId }));
  }

  @Post(':participationId/start')
  @RequirePermission(Permission.PARTICIPATE_IN_QUESTS)
  @HttpCode(200)
  @Throttle({ global: { limit: 30, ttl: 60_000 } })
  start(
    @CurrentPrincipal() principal: Principal,
    @Param('participationId', new ZodValidationPipe(uuidSchema)) participationId: string,
  ): Promise<ParticipationView> {
    return this.participations.start(principal, participationId);
  }

  /**
   * Phase 02 end state: the participant declares completion and the attempt waits for evidence.
   * No XP, no badge, no verification — those are later phases by design.
   */
  @Post(':participationId/completion-request')
  @RequirePermission(Permission.PARTICIPATE_IN_QUESTS)
  @HttpCode(200)
  @Throttle({ global: { limit: 30, ttl: 60_000 } })
  requestCompletion(
    @CurrentPrincipal() principal: Principal,
    @Param('participationId', new ZodValidationPipe(uuidSchema)) participationId: string,
    @Body(new ZodValidationPipe(completionRequestSchema)) body: CompletionRequest,
  ): Promise<ParticipationView> {
    return this.participations.requestCompletion(principal, participationId, body.note);
  }

  @Post(':participationId/cancel')
  @RequirePermission(Permission.PARTICIPATE_IN_QUESTS)
  @HttpCode(200)
  cancel(
    @CurrentPrincipal() principal: Principal,
    @Param('participationId', new ZodValidationPipe(uuidSchema)) participationId: string,
  ): Promise<ParticipationView> {
    return this.participations.cancel(principal, participationId);
  }
}
