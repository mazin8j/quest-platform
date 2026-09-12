import { Module } from '@nestjs/common';

import { IdentityModule } from '../identity';
import { ProfilesModule } from '../profiles';
import { TrustSafetyModule } from '../trust-safety';
import { AdminQuestsController } from './api/admin-quests.controller';
import {
  ParticipationsController,
  QuestParticipationController,
} from './api/participations.controller';
import { QuestCategoriesController, QuestsController } from './api/quests.controller';
import { ParticipationService } from './application/participation.service';
import { QuestAccountDataService } from './application/quest-account-data.service';
import { QuestService } from './application/quest.service';
import { QuestViewService } from './application/quest-view.service';
import { ParticipationRepository } from './infrastructure/participation.repository';
import { QuestRepository } from './infrastructure/quest.repository';

/**
 * Quest bounded context: authoring, safety-gated publication, discovery and participation.
 *
 * It owns the `quest*` tables and nothing else. Everything it needs to know about an account
 * reaches it through ports the owning context exports — `ACCOUNT_FACTS` (Identity),
 * `PROFILE_QUERY` / `BLOCK_QUERY` (Profiles), `SAFETY_DECISION` (Trust & Safety) — so no query in
 * this module reads an identity or profile table, and no date of birth ever enters it.
 */
@Module({
  imports: [IdentityModule, ProfilesModule, TrustSafetyModule],
  controllers: [
    QuestsController,
    QuestCategoriesController,
    QuestParticipationController,
    ParticipationsController,
    AdminQuestsController,
  ],
  providers: [
    QuestRepository,
    ParticipationRepository,
    QuestService,
    QuestViewService,
    ParticipationService,
    QuestAccountDataService,
  ],
  exports: [QuestService, QuestViewService, ParticipationService],
})
export class QuestsModule {}
