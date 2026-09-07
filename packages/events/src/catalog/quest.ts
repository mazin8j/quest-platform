import { z } from 'zod';

import { defineEvent } from '../envelope';

/**
 * Quest context events (Phase 02). Payloads carry identifiers, states and hashes — never Quest
 * text, never anything about the owner beyond the account id. Consumers must be idempotent on
 * `eventId`.
 *
 * Aggregates: `quest` and `quest_participation`. Source: `api.quests`.
 */
const QUEST = 'quest';
const PARTICIPATION = 'quest_participation';

const questPayload = z.object({
  questId: z.uuid(),
  ownerAccountId: z.uuid(),
});

export const QuestDrafted = defineEvent({
  eventType: 'quest.quest.drafted',
  eventVersion: 1,
  aggregateType: QUEST,
  payloadSchema: questPayload.extend({
    categoryKey: z.string(),
    difficulty: z.string(),
    contentHash: z.string(),
  }),
});

export const QuestRevised = defineEvent({
  eventType: 'quest.quest.revised',
  eventVersion: 1,
  aggregateType: QUEST,
  payloadSchema: questPayload.extend({
    revision: z.number().int(),
    contentHash: z.string(),
    /** True when the edit changed safety-relevant content and therefore voided an approval. */
    safetyRelevantChange: z.boolean(),
    previousState: z.string(),
    state: z.string(),
  }),
});

/** Recorded for every assessment, whatever its outcome — the audit trail of the safety gate. */
export const QuestSafetyAssessed = defineEvent({
  eventType: 'quest.quest.safety-assessed',
  eventVersion: 1,
  aggregateType: QUEST,
  payloadSchema: questPayload.extend({
    assessmentId: z.uuid(),
    contentHash: z.string(),
    safetyState: z.string(),
    policyVersion: z.string(),
    decidedBy: z.enum(['RULES', 'AI', 'HUMAN']),
    /** Risk categories that fired, for trend analysis. No free text, no quoted content. */
    categories: z.array(z.string()),
  }),
});

export const QuestPublished = defineEvent({
  eventType: 'quest.quest.published',
  eventVersion: 1,
  aggregateType: QUEST,
  payloadSchema: questPayload.extend({
    version: z.number().int(),
    contentHash: z.string(),
    assessmentId: z.uuid(),
    visibility: z.string(),
    minimumAgeBand: z.string(),
  }),
});

export const QuestUnpublished = defineEvent({
  eventType: 'quest.quest.unpublished',
  eventVersion: 1,
  aggregateType: QUEST,
  payloadSchema: questPayload.extend({
    reason: z.enum(['REVISED', 'ARCHIVED', 'SUSPENDED', 'ERASED']),
    state: z.string(),
  }),
});

export const QuestSuspended = defineEvent({
  eventType: 'quest.quest.suspended',
  eventVersion: 1,
  aggregateType: QUEST,
  payloadSchema: questPayload.extend({ byStaffAccountId: z.uuid() }),
});

export const QuestReinstated = defineEvent({
  eventType: 'quest.quest.reinstated',
  eventVersion: 1,
  aggregateType: QUEST,
  payloadSchema: questPayload.extend({ byStaffAccountId: z.uuid() }),
});

export const QuestErased = defineEvent({
  eventType: 'quest.quest.erased',
  eventVersion: 1,
  aggregateType: QUEST,
  payloadSchema: questPayload.extend({ questCount: z.number().int().optional() }),
});

const participationPayload = z.object({
  participationId: z.uuid(),
  questId: z.uuid(),
  accountId: z.uuid(),
  questVersion: z.number().int(),
});

export const QuestAccepted = defineEvent({
  eventType: 'quest.participation.accepted',
  eventVersion: 1,
  aggregateType: PARTICIPATION,
  payloadSchema: participationPayload,
});

export const QuestStarted = defineEvent({
  eventType: 'quest.participation.started',
  eventVersion: 1,
  aggregateType: PARTICIPATION,
  payloadSchema: participationPayload.extend({ expiresAt: z.string() }),
});

export const QuestCompletionRequested = defineEvent({
  eventType: 'quest.participation.completion-requested',
  eventVersion: 1,
  aggregateType: PARTICIPATION,
  /** Phase 02 stops here: evidence verification and rewards belong to later phases. */
  payloadSchema: participationPayload.extend({ evidenceRequired: z.boolean() }),
});

export const QuestParticipationCancelled = defineEvent({
  eventType: 'quest.participation.cancelled',
  eventVersion: 1,
  aggregateType: PARTICIPATION,
  payloadSchema: participationPayload.extend({
    reason: z.enum(['PARTICIPANT', 'QUEST_WITHDRAWN', 'EXPIRED']),
  }),
});
