import { safetyRiskCategorySchema, safetyPolicyStateSchema } from '@quest/types';
import { z } from 'zod';

/**
 * Capability contracts the product will call (Phase 06 implements them on top of AiGateway).
 * They are defined now so Phases 02–05 code against stable interfaces, not provider APIs.
 * NOTE: these are shapes only. No prompts, no models, no providers exist in Phase 00.
 */

// ---- generateQuest() ----
export const questGenerationInputSchema = z.object({
  interests: z.array(z.string()).max(20),
  languageTag: z.string(),
  countryCode: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .optional(),
  difficulty: z.enum(['EASY', 'MEDIUM', 'HARD']).optional(),
  audienceIncludesMinors: z.boolean().default(false),
});
export const questGenerationOutputSchema = z.object({
  title: z.string().max(120),
  description: z.string().max(2000),
  instructions: z.array(z.string().max(500)).max(10),
  estimatedMinutes: z.number().int().positive(),
  suggestedEvidence: z.array(z.enum(['PHOTO', 'VIDEO', 'LOCATION_CHECKIN', 'TEXT'])),
});
export interface QuestGenerationCapability {
  generateQuest(
    input: z.infer<typeof questGenerationInputSchema>,
    ctx: { correlationId: string; actorId?: string },
  ): Promise<z.infer<typeof questGenerationOutputSchema>>;
}

// ---- classifyQuestSafety() ----
export const questSafetyClassificationInputSchema = z.object({
  text: z.record(z.string(), z.string()),
  audienceIncludesMinors: z.boolean().default(false),
  countryCode: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .optional(),
});
export const questSafetyClassificationOutputSchema = z.object({
  /** Suggested state; the deterministic publish rule in @quest/types has the final word. */
  suggestedState: safetyPolicyStateSchema,
  signals: z.array(
    z.object({
      category: safetyRiskCategorySchema,
      score: z.number().min(0).max(1),
      rationale: z.string().max(500).optional(),
    }),
  ),
});
export interface QuestSafetyClassificationCapability {
  classifyQuestSafety(
    input: z.infer<typeof questSafetyClassificationInputSchema>,
    ctx: { correlationId: string; actorId?: string },
  ): Promise<z.infer<typeof questSafetyClassificationOutputSchema>>;
}

// ---- analyzeProof() ----
export const proofAnalysisInputSchema = z.object({
  questRequirements: z.array(z.string()),
  /** Object-storage keys — never public URLs, never raw bytes through the API. */
  evidenceObjectKeys: z.array(z.string()).min(1).max(10),
  evidenceKinds: z.array(z.enum(['PHOTO', 'VIDEO', 'TEXT'])),
});
export const proofAnalysisOutputSchema = z.object({
  /** 0–1 confidence that the evidence satisfies the requirements. Never a final verdict. */
  confidence: z.number().min(0).max(1),
  findings: z.array(z.string().max(300)).max(20),
  recommendHumanReview: z.boolean(),
});
export interface ProofAnalysisCapability {
  analyzeProof(
    input: z.infer<typeof proofAnalysisInputSchema>,
    ctx: { correlationId: string; actorId?: string },
  ): Promise<z.infer<typeof proofAnalysisOutputSchema>>;
}

// ---- rankRecommendations() ----
export const recommendationRankingInputSchema = z.object({
  candidateIds: z.array(z.string()).min(1).max(200),
  /** Non-identifying feature summary; never raw profile data. */
  contextFeatures: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
});
export const recommendationRankingOutputSchema = z.object({
  ranked: z.array(
    z.object({ id: z.string(), score: z.number(), reason: z.string().max(200).optional() }),
  ),
});
export interface RecommendationRankingCapability {
  rankRecommendations(
    input: z.infer<typeof recommendationRankingInputSchema>,
    ctx: { correlationId: string; actorId?: string },
  ): Promise<z.infer<typeof recommendationRankingOutputSchema>>;
}
