import { z } from 'zod';

import { paginatedSchema } from '../api/pagination';
import { safetyPolicyStateSchema } from '../safety';
import {
  questAgeBandSchema,
  questCategoryKeySchema,
  questContentSchema,
  questDifficultySchema,
  questDurationSchema,
  questEligibilitySchema,
  questLocationSchema,
  questVisibilitySchema,
  evidenceRequirementSchema,
} from './content';
import { participationStateSchema, questStateSchema } from './lifecycle';

/**
 * Quest API contracts (Phase 02). Requests never carry an owner id, an age band or a safety state:
 * ownership comes from the authenticated principal, the age band from Identity, and the safety
 * state only from a recorded assessment.
 */

// -------------------------------------------------------------------------------- requests ----

export const createQuestRequestSchema = z.object({
  content: questContentSchema,
  duration: questDurationSchema,
  visibility: questVisibilitySchema.default('PUBLIC'),
});
export type CreateQuestRequest = z.infer<typeof createQuestRequestSchema>;

/** A full replacement of the editable state; partial edits would make hashing ambiguous. */
export const updateQuestRequestSchema = z.object({
  content: questContentSchema,
  duration: questDurationSchema,
  visibility: questVisibilitySchema,
  /**
   * Optimistic concurrency: the revision the client last saw. A concurrent edit (or a publish that
   * happened in between) makes the update fail with CONFLICT rather than silently overwriting.
   */
  expectedRevision: z.number().int().min(1),
});
export type UpdateQuestRequest = z.infer<typeof updateQuestRequestSchema>;

export const publishQuestRequestSchema = z.object({
  /** The content hash the owner believes they are publishing; must match the stored one. */
  expectedContentHash: z.string().min(16).max(128),
});
export type PublishQuestRequest = z.infer<typeof publishQuestRequestSchema>;

export const archiveQuestRequestSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});
export type ArchiveQuestRequest = z.infer<typeof archiveQuestRequestSchema>;

export const suspendQuestRequestSchema = z.object({
  reason: z.string().trim().min(5).max(500),
});
export type SuspendQuestRequest = z.infer<typeof suspendQuestRequestSchema>;

export const questListQuerySchema = z.object({
  categoryKey: questCategoryKeySchema.optional(),
  difficulty: questDifficultySchema.optional(),
  cursor: z.string().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type QuestListQuery = z.infer<typeof questListQuerySchema>;

// ----------------------------------------------------------------------------------- views ----

/** Public owner card. Never an email, never a DOB — the Profiles context decides what is shown. */
export const questOwnerCardSchema = z.object({
  accountId: z.uuid(),
  username: z.string().nullable(),
  displayName: z.string().nullable(),
});
export type QuestOwnerCard = z.infer<typeof questOwnerCardSchema>;

/** What a participant is told about safety before accepting. */
export const questSafetyBadgeSchema = z.object({
  state: safetyPolicyStateSchema,
  /** Warning copy the participant must see (ALLOWED_WITH_WARNING / RESTRICTED outcomes). */
  warning: z.string().nullable(),
  minimumAgeBand: questAgeBandSchema,
  policyVersion: z.string(),
  assessedAt: z.string(),
});
export type QuestSafetyBadge = z.infer<typeof questSafetyBadgeSchema>;

const questCoreShape = {
  questId: z.uuid(),
  state: questStateSchema,
  visibility: questVisibilitySchema,
  revision: z.number().int().min(1),
  /** Published version number; null while the Quest has never been published. */
  publishedVersion: z.number().int().min(1).nullable(),
  title: z.string(),
  summary: z.string(),
  categoryKey: questCategoryKeySchema,
  difficulty: questDifficultySchema,
  duration: questDurationSchema,
  eligibility: questEligibilitySchema,
  location: questLocationSchema.nullable(),
  owner: questOwnerCardSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  publishedAt: z.string().nullable(),
};

/** Discovery card: enough to decide whether to open a Quest, nothing more. */
export const questCardSchema = z.object({
  ...questCoreShape,
  safety: questSafetyBadgeSchema.nullable(),
  /** Whether the caller already has an active participation. */
  participating: z.boolean(),
});
export type QuestCard = z.infer<typeof questCardSchema>;

/** Full detail, including the instructions a participant needs. */
export const questDetailSchema = z.object({
  ...questCoreShape,
  instructions: z.string(),
  safetyNotes: z.string().nullable(),
  evidence: evidenceRequirementSchema,
  safety: questSafetyBadgeSchema.nullable(),
  participating: z.boolean(),
  /** Owner-only fields; null for other viewers. */
  contentHash: z.string().nullable(),
  publishedContentHash: z.string().nullable(),
  /** Why the Quest cannot be published right now (owner view only). */
  publishBlockers: z.array(z.string()).nullable(),
});
export type QuestDetail = z.infer<typeof questDetailSchema>;

export const questListSchema = paginatedSchema(questCardSchema);
export type QuestList = z.infer<typeof questListSchema>;

export const questCategoryListSchema = z.object({
  data: z.array(
    z.object({ key: questCategoryKeySchema, label: z.string(), sortOrder: z.number().int() }),
  ),
});

/** Result of asking for an assessment: the recorded decision, not a promise about publication. */
export const questAssessmentViewSchema = z.object({
  assessmentId: z.uuid(),
  questId: z.uuid(),
  contentHash: z.string(),
  state: safetyPolicyStateSchema,
  categories: z.array(z.string()),
  policyVersion: z.string(),
  decidedBy: z.enum(['RULES', 'AI', 'HUMAN']),
  assessedAt: z.string(),
  /** Whether this decision, for this hash, currently permits publication. */
  publishable: z.boolean(),
  reason: z.string(),
});
export type QuestAssessmentView = z.infer<typeof questAssessmentViewSchema>;

// --------------------------------------------------------------------------- participation ----

export const acceptQuestRequestSchema = z.object({
  /**
   * The Quest version the participant is accepting. Optional: a client that read the Quest and
   * wants to be sure it is accepting *that* version sends it and gets a 409 if the owner has
   * republished since; a client that does not care simply accepts whatever is published now.
   */
  expectedPublishedVersion: z.number().int().min(1).optional(),
});
export type AcceptQuestRequest = z.infer<typeof acceptQuestRequestSchema>;

export const completionRequestSchema = z.object({
  note: z.string().trim().max(1000).optional(),
});
export type CompletionRequest = z.infer<typeof completionRequestSchema>;

export const participationViewSchema = z.object({
  participationId: z.uuid(),
  questId: z.uuid(),
  /** The version accepted — participation is bound to it even if the Quest changes later. */
  questVersion: z.number().int().min(1),
  questTitle: z.string(),
  state: participationStateSchema,
  acceptedAt: z.string(),
  startedAt: z.string().nullable(),
  /** Deadline derived from the accepted version's completion window; null before START. */
  expiresAt: z.string().nullable(),
  completionRequestedAt: z.string().nullable(),
  cancelledAt: z.string().nullable(),
});
export type ParticipationView = z.infer<typeof participationViewSchema>;

export const participationListSchema = paginatedSchema(participationViewSchema);
export type ParticipationList = z.infer<typeof participationListSchema>;

// ------------------------------------------------------------------------------ staff view ----

export const questSupportViewSchema = z.object({
  questId: z.uuid(),
  ownerAccountId: z.uuid(),
  state: questStateSchema,
  visibility: questVisibilitySchema,
  title: z.string(),
  revision: z.number().int(),
  contentHash: z.string(),
  publishedContentHash: z.string().nullable(),
  publishedAt: z.string().nullable(),
  suspendedAt: z.string().nullable(),
  suspensionReason: z.string().nullable(),
  participationCount: z.number().int(),
  assessments: z.array(questAssessmentViewSchema),
});
export type QuestSupportView = z.infer<typeof questSupportViewSchema>;
