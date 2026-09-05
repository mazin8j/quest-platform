import { Module } from '@nestjs/common';

import { FailClosedSafetyDecision } from './domain/fail-closed-safety-decision';

/** DI token for the SafetyDecisionPort. Phase 02 injects this before any Quest publish transition. */
export const SAFETY_DECISION = Symbol('SAFETY_DECISION');

@Module({
  providers: [{ provide: SAFETY_DECISION, useClass: FailClosedSafetyDecision }],
  exports: [SAFETY_DECISION],
})
export class TrustSafetyModule {}
