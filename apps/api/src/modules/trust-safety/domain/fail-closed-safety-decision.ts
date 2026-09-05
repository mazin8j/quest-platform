import { randomUUID } from 'node:crypto';

import {
  SafetyPolicyState,
  type SafetyAssessment,
  type SafetyAssessmentInput,
  type SafetyAssessmentInputData,
  type SafetyDecisionPort,
  safetyAssessmentInputSchema,
} from '@quest/types';

export const SAFETY_POLICY_VERSION_PHASE00 = 'quest-safety-policy@0';

/**
 * Phase 00 implementation of the SafetyDecisionPort: every subject is routed to human review.
 * This guarantees that if Phase 02 wires publication before a real policy engine exists, nothing
 * can be published — the system fails closed rather than open. Phase 02 replaces this with a
 * rule-based engine; Phase 06 adds the AI classifier behind the AI Gateway; Phase 14 hardens.
 */
export class FailClosedSafetyDecision implements SafetyDecisionPort {
  assess(input: SafetyAssessmentInputData): Promise<SafetyAssessment> {
    // Validation errors become rejections (never synchronous throws) so callers handle one path.
    return Promise.resolve().then(() => this.decide(safetyAssessmentInputSchema.parse(input)));
  }

  private decide(valid: SafetyAssessmentInput): SafetyAssessment {
    return {
      assessmentId: randomUUID(),
      subjectType: valid.subjectType,
      subjectId: valid.subjectId,
      subjectContentVersion: valid.subjectContentVersion,
      state: SafetyPolicyState.REVIEW_REQUIRED,
      signals: [],
      policyVersion: SAFETY_POLICY_VERSION_PHASE00,
      decidedBy: 'RULES',
      assessedAt: new Date().toISOString(),
    };
  }
}
