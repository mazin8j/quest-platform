import { createHash } from 'node:crypto';

import {
  type QuestAgeBand,
  type QuestContent,
  QuestState,
  type QuestTransition,
  type QuestVisibility,
  type SafetyAssessment,
  ageBandForMinimumAge,
  canPublishWithAssessment,
  canonicalQuestContent,
  nextQuestState,
  strictestAgeBand,
} from '@quest/types';

import { ApiError } from '../../../common/filters/api-error';

/**
 * Quest domain rules. Pure functions only — no I/O, no framework — so the publish gate can be
 * tested exhaustively and read in one sitting.
 */

export interface QuestRecord {
  id: string;
  ownerAccountId: string;
  state: QuestState;
  visibility: QuestVisibility;
  revision: number;
  title: string;
  summary: string;
  instructions: string;
  safetyNotes: string | null;
  categoryKey: string;
  difficulty: string;
  evidence: unknown;
  eligibility: unknown;
  locationCountryCode: string | null;
  locationLabel: string | null;
  effortMinutes: number;
  completionWindowHours: number;
  availableFrom: Date | null;
  availableUntil: Date | null;
  contentHash: string;
  publishedVersion: number | null;
  publishedContentHash: string | null;
  publishedAssessmentId: string | null;
  publishedAt: Date | null;
  publishedMinimumAgeBand: string | null;
  archivedAt: Date | null;
  suspendedAt: Date | null;
  suspensionReason: string | null;
  erasedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AssessmentRecord {
  id: string;
  questId: string;
  contentHash: string;
  state: SafetyAssessment['state'];
  signals: SafetyAssessment['signals'];
  restrictions: SafetyAssessment['restrictions'];
  policyVersion: string;
  decidedBy: SafetyAssessment['decidedBy'];
  assessedAt: Date;
}

/**
 * The content hash. SHA-256 over the canonical serialisation of the safety-relevant fields
 * (`canonicalQuestContent` in `@quest/types`, shared with every client so the same input always
 * hashes the same way). Any change to those fields produces a different hash, which is exactly
 * what makes a previous safety approval detectably stale.
 */
export function questContentHash(content: QuestContent): string {
  return createHash('sha256').update(canonicalQuestContent(content), 'utf8').digest('hex');
}

/** Applies a lifecycle transition or throws CONFLICT — the only way a Quest state changes. */
export function transitionQuest(from: QuestState, transition: QuestTransition): QuestState {
  const next = nextQuestState(from, transition);
  if (!next) {
    throw ApiError.conflict(`Cannot ${transition.toLowerCase().replace('_', ' ')} a ${from} Quest`);
  }
  return next;
}

export interface PublishDecision {
  allowed: boolean;
  /** Machine-readable blockers, safe to show the owner. Empty when `allowed`. */
  blockers: string[];
  /** The age band the Quest must be published with (owner's choice, tightened by safety). */
  minimumAgeBand: QuestAgeBand;
}

export interface PublishGateInput {
  quest: QuestRecord;
  /** The most recent assessment for this Quest, whatever its content hash. */
  latestAssessment: AssessmentRecord | null;
  /** Owner's declared minimum band from the current content. */
  declaredMinimumAgeBand: QuestAgeBand;
  /** Owner facts from the Identity context (never read from its tables). */
  owner: { accountId: string; state: string; emailVerified: boolean };
  /** Caller asking to publish. */
  actorAccountId: string;
  /** The hash the client believes it is publishing. */
  expectedContentHash: string;
  /** Assessments older than this are treated as stale even when the hash still matches. */
  maxAssessmentAgeMs: number;
  now: Date;
}

/**
 * THE publish gate. Fail-closed: it returns `allowed` only when every condition below holds, and
 * the caller must additionally persist the assessment id it relied on (the database CHECK
 * `quest_published_requires_assessment` refuses a PUBLISHED row without one).
 *
 * Conditions — no Quest becomes visible when any of these fails:
 *  1. the actor is the owner;
 *  2. the owner account is ACTIVE with a verified email;
 *  3. the lifecycle state permits publication (DRAFT only — IN_REVIEW must be revised first);
 *  4. the client's expected hash matches the stored content hash (no publish-while-editing race);
 *  5. an assessment exists, was made about this exact content hash, and is not older than the
 *     configured maximum age;
 *  6. `canPublishWithAssessment` (the shared Trust & Safety rule) allows the state;
 *  7. the age band the Quest will carry satisfies any minimum age the assessment imposed.
 */
export function evaluatePublish(input: PublishGateInput): PublishDecision {
  const { quest, latestAssessment: assessment } = input;
  const blockers: string[] = [];

  if (quest.ownerAccountId !== input.actorAccountId) blockers.push('NOT_OWNER');
  if (input.owner.state !== 'ACTIVE') blockers.push('OWNER_NOT_ACTIVE');
  if (!input.owner.emailVerified) blockers.push('OWNER_EMAIL_NOT_VERIFIED');
  if (nextQuestState(quest.state, 'PUBLISH') !== QuestState.PUBLISHED) {
    blockers.push(`INVALID_STATE_${quest.state}`);
  }
  if (input.expectedContentHash !== quest.contentHash) blockers.push('CONTENT_HASH_MISMATCH');

  let minimumAgeBand = input.declaredMinimumAgeBand;
  if (!assessment) {
    blockers.push('NO_SAFETY_ASSESSMENT');
  } else {
    if (assessment.contentHash !== quest.contentHash) blockers.push('SAFETY_ASSESSMENT_STALE');
    if (input.now.getTime() - assessment.assessedAt.getTime() > input.maxAssessmentAgeMs) {
      blockers.push('SAFETY_ASSESSMENT_EXPIRED');
    }
    const rule = canPublishWithAssessment(
      {
        assessmentId: assessment.id,
        subjectType: 'QUEST',
        subjectId: quest.id,
        subjectContentVersion: assessment.contentHash,
        state: assessment.state,
        signals: assessment.signals,
        restrictions: assessment.restrictions,
        policyVersion: assessment.policyVersion,
        decidedBy: assessment.decidedBy,
        assessedAt: assessment.assessedAt.toISOString(),
      },
      quest.contentHash,
    );
    if (!rule.allowed) blockers.push(`SAFETY_${assessment.state}`);

    const requiredAge = assessment.restrictions?.minimumAge;
    if (requiredAge !== undefined) {
      minimumAgeBand = strictestAgeBand(minimumAgeBand, ageBandForMinimumAge(requiredAge));
    }
  }

  return { allowed: blockers.length === 0, blockers, minimumAgeBand };
}

/** Countries a published Quest may be accepted from, folding safety restrictions into the owner's. */
export function effectiveCountryRules(
  declared: { allowedCountries: string[]; blockedCountries: string[] },
  assessment: AssessmentRecord | null,
): { allowedCountries: string[]; blockedCountries: string[] } {
  const restrictions = assessment?.restrictions;
  const allowed = new Set(declared.allowedCountries);
  const blocked = new Set([
    ...declared.blockedCountries,
    ...(restrictions?.blockedCountries ?? []),
  ]);
  for (const country of restrictions?.allowedCountries ?? []) {
    // An assessment allow-list narrows: when both sides list countries, keep the intersection.
    if (declared.allowedCountries.length === 0) allowed.add(country);
  }
  if (declared.allowedCountries.length > 0 && (restrictions?.allowedCountries.length ?? 0) > 0) {
    for (const country of [...allowed]) {
      if (!restrictions?.allowedCountries.includes(country)) allowed.delete(country);
    }
  }
  return { allowedCountries: [...allowed].sort(), blockedCountries: [...blocked].sort() };
}
