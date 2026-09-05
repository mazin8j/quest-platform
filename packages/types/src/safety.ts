import { z } from 'zod';

/**
 * QUEST Trust & Safety baseline contract.
 * Canonical policy documentation: docs/security/QUEST_SAFETY_BASELINE.md
 *
 * This contract exists in Phase 00 so that Phase 02 (Quest publication) cannot ship without an
 * enforcement point. It is deliberately deterministic and provider-independent: an AI classifier
 * (Phase 06) may *produce* an assessment, but the publish rule below is code, not a model.
 */

/** Policy state of a Quest (or any user-generated challenge) with respect to safety review. */
export const SafetyPolicyState = {
  /** No assessment recorded yet. Fail-closed: cannot be published. */
  UNASSESSED: 'UNASSESSED',
  /** Assessed and allowed without conditions. */
  ALLOWED: 'ALLOWED',
  /** Allowed but must display a safety warning / disclaimer to participants. */
  ALLOWED_WITH_WARNING: 'ALLOWED_WITH_WARNING',
  /** Allowed only for a restricted audience (age and/or region gates apply). */
  RESTRICTED: 'RESTRICTED',
  /** Blocked pending human moderator review. */
  REVIEW_REQUIRED: 'REVIEW_REQUIRED',
  /** Rejected by policy; may be appealed. */
  REJECTED: 'REJECTED',
  /** Rejected and escalated (imminent harm, illegal content). Not appealable through self-service. */
  ESCALATED: 'ESCALATED',
} as const;
export type SafetyPolicyState = (typeof SafetyPolicyState)[keyof typeof SafetyPolicyState];
export const safetyPolicyStateSchema = z.enum(
  Object.values(SafetyPolicyState) as [SafetyPolicyState, ...SafetyPolicyState[]],
);

/** Risk categories every assessment must consider. Additive only; never rename. */
export const SafetyRiskCategory = {
  DANGEROUS_PHYSICAL_ACTIVITY: 'DANGEROUS_PHYSICAL_ACTIVITY',
  ILLEGAL_BEHAVIOR: 'ILLEGAL_BEHAVIOR',
  SELF_HARM: 'SELF_HARM',
  VIOLENCE: 'VIOLENCE',
  DRUGS: 'DRUGS',
  ALCOHOL: 'ALCOHOL',
  DANGEROUS_DRIVING: 'DANGEROUS_DRIVING',
  MINORS: 'MINORS',
  BULLYING: 'BULLYING',
  HARASSMENT: 'HARASSMENT',
  SEXUAL_CONTENT: 'SEXUAL_CONTENT',
  DANGEROUS_LOCATION: 'DANGEROUS_LOCATION',
  TRESPASSING: 'TRESPASSING',
  WEAPONS: 'WEAPONS',
  PRIVACY_INVASION: 'PRIVACY_INVASION',
  HUMILIATION_OR_COERCION: 'HUMILIATION_OR_COERCION',
} as const;
export type SafetyRiskCategory = (typeof SafetyRiskCategory)[keyof typeof SafetyRiskCategory];
export const safetyRiskCategorySchema = z.enum(
  Object.values(SafetyRiskCategory) as [SafetyRiskCategory, ...SafetyRiskCategory[]],
);

export const safetyRiskSignalSchema = z.object({
  category: safetyRiskCategorySchema,
  /** 0 = no signal, 1 = certain. */
  score: z.number().min(0).max(1),
  /** Short, non-PII rationale suitable for a moderator queue. */
  rationale: z.string().max(500).optional(),
});
export type SafetyRiskSignal = z.infer<typeof safetyRiskSignalSchema>;

/** Audience restrictions attached to RESTRICTED (and optionally ALLOWED_WITH_WARNING) outcomes. */
export const safetyRestrictionsSchema = z.object({
  minimumAge: z.number().int().min(13).max(21).optional(),
  /** ISO 3166-1 alpha-2 codes where the content is NOT available. */
  blockedCountries: z.array(z.string().regex(/^[A-Z]{2}$/)).default([]),
  /** ISO 3166-1 alpha-2 codes where the content is ONLY available (empty = everywhere else). */
  allowedCountries: z.array(z.string().regex(/^[A-Z]{2}$/)).default([]),
  requiresWarningText: z.string().max(500).optional(),
});
export type SafetyRestrictions = z.infer<typeof safetyRestrictionsSchema>;

/**
 * The append-only assessment record. Reconsideration creates a new record that supersedes the
 * previous one (quest-domain rule: verification/safety decisions are auditable, never mutated).
 */
export const safetyAssessmentSchema = z.object({
  assessmentId: z.uuid(),
  /** What was assessed, e.g. "QUEST" and its id. */
  subjectType: z.string().min(1),
  subjectId: z.string().min(1),
  /** Hash/version of the subject content assessed, so later edits are detectably unassessed. */
  subjectContentVersion: z.string().min(1),
  state: safetyPolicyStateSchema,
  signals: z.array(safetyRiskSignalSchema),
  restrictions: safetyRestrictionsSchema.optional(),
  /** Identifier + version of the policy that produced this state (e.g. "quest-safety-policy@1"). */
  policyVersion: z.string().min(1),
  /** RULES (deterministic), AI (model-produced), HUMAN (moderator). */
  decidedBy: z.enum(['RULES', 'AI', 'HUMAN']),
  /** For AI decisions: provider/model/prompt metadata reference kept in the AI audit store. */
  aiInvocationRef: z.string().optional(),
  supersedesAssessmentId: z.uuid().optional(),
  assessedAt: z.string(),
});
export type SafetyAssessment = z.infer<typeof safetyAssessmentSchema>;

/** States in which content may be visible to (some) participants. */
const PUBLISHABLE_STATES: ReadonlySet<SafetyPolicyState> = new Set([
  SafetyPolicyState.ALLOWED,
  SafetyPolicyState.ALLOWED_WITH_WARNING,
  SafetyPolicyState.RESTRICTED,
]);

/**
 * THE publish rule. Deterministic; no I/O. Phase 02 must call this before any transition to
 * PUBLISHED and must persist the assessmentId it relied on.
 */
export function canPublishWithSafetyState(state: SafetyPolicyState): boolean {
  return PUBLISHABLE_STATES.has(state);
}

/**
 * A stricter check that also detects stale assessments: the assessment must match the exact
 * content version being published.
 */
export function canPublishWithAssessment(
  assessment: SafetyAssessment | null | undefined,
  currentContentVersion: string,
): { allowed: boolean; reason: string } {
  if (!assessment) {
    return { allowed: false, reason: 'No safety assessment recorded (UNASSESSED).' };
  }
  if (assessment.subjectContentVersion !== currentContentVersion) {
    return {
      allowed: false,
      reason: 'Safety assessment is stale for the current content version.',
    };
  }
  if (!canPublishWithSafetyState(assessment.state)) {
    return {
      allowed: false,
      reason: `Safety state ${assessment.state} does not permit publication.`,
    };
  }
  return { allowed: true, reason: 'Safety assessment permits publication.' };
}

/**
 * Port that Phase 02 will depend on. Implementations: rule-based (Phase 02), AI-assisted via the
 * AI Gateway (Phase 06), human moderation (Phase 14). Implementations MUST be fail-closed: on any
 * error they return REVIEW_REQUIRED, never ALLOWED.
 */
export interface SafetyDecisionPort {
  assess(input: SafetyAssessmentInputData): Promise<SafetyAssessment>;
}

export const safetyAssessmentInputSchema = z.object({
  subjectType: z.string().min(1),
  subjectId: z.string().min(1),
  subjectContentVersion: z.string().min(1),
  /** Text fields to assess; keys are field names (title, description, instructions...). */
  text: z.record(z.string(), z.string()),
  /** Whether the author is a minor or the audience may include minors. Never carries identity. */
  audienceIncludesMinors: z.boolean().default(false),
  /** Coarse location context if relevant (country only, never precise coordinates). */
  countryCode: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .optional(),
  correlationId: z.string().optional(),
});
export type SafetyAssessmentInput = z.infer<typeof safetyAssessmentInputSchema>;
/** Caller-side shape (defaults such as audienceIncludesMinors not yet applied). */
export type SafetyAssessmentInputData = z.input<typeof safetyAssessmentInputSchema>;
