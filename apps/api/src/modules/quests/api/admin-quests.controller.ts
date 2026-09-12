import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import {
  Permission,
  type QuestSupportView,
  type SuspendQuestRequest,
  suspendQuestRequestSchema,
  uuidSchema,
} from '@quest/types';

import { CurrentPrincipal, RequirePermission } from '../../../common/auth/decorators';
import type { Principal } from '../../../common/auth/principal';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { QuestService } from '../application/quest.service';

/**
 * Staff support surface for Quests: read a Quest with its assessment history, withdraw it from
 * visibility, put it back to DRAFT. Deliberately not a moderation queue — cases, appeals and
 * sanctions are Phase 14; this is the minimum needed to take a dangerous Quest down today.
 */
@Controller({ path: 'admin/quests', version: '1' })
export class AdminQuestsController {
  constructor(private readonly quests: QuestService) {}

  @Get(':questId')
  @RequirePermission(Permission.VIEW_QUEST_SUPPORT)
  supportView(
    @Param('questId', new ZodValidationPipe(uuidSchema)) questId: string,
  ): Promise<QuestSupportView> {
    return this.quests.supportView(questId);
  }

  @Post(':questId/suspend')
  @RequirePermission(Permission.SANCTION_QUEST)
  @HttpCode(200)
  suspend(
    @CurrentPrincipal() staff: Principal,
    @Param('questId', new ZodValidationPipe(uuidSchema)) questId: string,
    @Body(new ZodValidationPipe(suspendQuestRequestSchema)) body: SuspendQuestRequest,
  ): Promise<QuestSupportView> {
    return this.quests.suspend(staff, questId, body);
  }

  @Post(':questId/reinstate')
  @RequirePermission(Permission.SANCTION_QUEST)
  @HttpCode(200)
  reinstate(
    @CurrentPrincipal() staff: Principal,
    @Param('questId', new ZodValidationPipe(uuidSchema)) questId: string,
  ): Promise<QuestSupportView> {
    return this.quests.reinstate(staff, questId);
  }
}
