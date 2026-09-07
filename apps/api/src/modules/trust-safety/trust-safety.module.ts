import { Module } from '@nestjs/common';

import { RuleBasedSafetyDecision } from './domain/rule-based-safety-decision';

/**
 * DI token for the SafetyDecisionPort. Every transition to a publicly visible state must obtain an
 * assessment through this port and evaluate it with `canPublishWithAssessment` (Phase 02 gate).
 */
export const SAFETY_DECISION = Symbol('SAFETY_DECISION');

@Module({
  // Phase 00 shipped FailClosedSafetyDecision (everything to human review) so that wiring
  // publication before a policy engine existed could not publish anything. Phase 02 replaces it
  // with the rule engine, which is itself fail-closed on error (docs/security/QUEST_SAFETY_BASELINE.md).
  providers: [{ provide: SAFETY_DECISION, useClass: RuleBasedSafetyDecision }],
  exports: [SAFETY_DECISION],
})
export class TrustSafetyModule {}
