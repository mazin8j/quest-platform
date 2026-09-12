import { randomUUID } from 'node:crypto';

import {
  SafetyPolicyState,
  type SafetyAssessment,
  type SafetyAssessmentInput,
  type SafetyAssessmentInputData,
  type SafetyDecisionPort,
  type SafetyRestrictions,
  type SafetyRiskSignal,
  safetyAssessmentInputSchema,
} from '@quest/types';

import {
  SAFETY_LEXICON,
  SafetyTier,
  normaliseForMatching,
  type LexiconRule,
} from './safety-lexicon';

/** Bump when the lexicon or the tier→state mapping changes; recorded on every assessment. */
export const SAFETY_POLICY_VERSION_PHASE02 = 'quest-safety-policy@1';

/** Minimum age applied when a signal is adults-only. */
const ADULT_MINIMUM_AGE = 18;

/** Below this there is nothing to decide about, so the engine refuses rather than allows. */
const MINIMUM_ASSESSABLE_LENGTH = 10;

const WARNING_COPY: Readonly<Record<string, string>> = {
  DANGEROUS_PHYSICAL_ACTIVITY:
    'Physical activity: judge your own fitness, stop if you feel unwell, and do not attempt this alone if you are unsure.',
  DANGEROUS_LOCATION:
    'Take care with where and when you do this: tell someone where you are going and avoid unlit or isolated places.',
  ALCOHOL: 'Contains alcohol. Adults only, and drink responsibly.',
};

/**
 * Phase 02 rule-based safety engine (Trust & Safety context).
 *
 * Deterministic by design: the same text always produces the same decision, and the decision is a
 * rule, not a model (docs/security/QUEST_SAFETY_BASELINE.md §3). AI classification arrives in
 * Phase 06 and may only *suggest* — this engine, or a human, still decides.
 *
 * Fail-closed: any unexpected error, including invalid input, yields REVIEW_REQUIRED. There is no
 * code path in which this class returns ALLOWED without having examined the text.
 */
export class RuleBasedSafetyDecision implements SafetyDecisionPort {
  async assess(input: SafetyAssessmentInputData): Promise<SafetyAssessment> {
    try {
      return await Promise.resolve(this.decide(safetyAssessmentInputSchema.parse(input)));
    } catch {
      // Never leak the reason to the caller; never allow. A malformed subject is a review case.
      return this.review(input, 'Assessment could not be completed');
    }
  }

  private decide(valid: SafetyAssessmentInput): SafetyAssessment {
    const text = normaliseForMatching(Object.values(valid.text).join('\n'));
    // The one path that could reach ALLOWED without examining anything: nothing to examine. A
    // caller that submits no text has not been assessed, so it is a review case (audit P02-27).
    if (text.length < MINIMUM_ASSESSABLE_LENGTH) {
      return this.review(valid, 'No assessable content was submitted');
    }
    const matches = SAFETY_LEXICON.filter((rule) => rule.pattern.test(text));
    const signals: SafetyRiskSignal[] = dedupeSignals(matches);

    const worst = worstTier(matches);
    const audienceIncludesMinors = valid.audienceIncludesMinors;

    // Order matters: the most restrictive outcome always wins.
    if (worst === SafetyTier.PROHIBITED) {
      const escalate = matches.some(
        (m) => m.tier === SafetyTier.PROHIBITED && ESCALATION_CATEGORIES.has(m.category),
      );
      return this.record(valid, {
        state: escalate ? SafetyPolicyState.ESCALATED : SafetyPolicyState.REJECTED,
        signals,
      });
    }
    if (worst === SafetyTier.REVIEW) {
      return this.record(valid, { state: SafetyPolicyState.REVIEW_REQUIRED, signals });
    }
    if (worst === SafetyTier.ADULT_ONLY) {
      // Adults-only content with an audience that may include minors is a review case, not a
      // silent age gate: the owner has to be told, and a human should see the combination.
      if (audienceIncludesMinors) {
        return this.record(valid, { state: SafetyPolicyState.REVIEW_REQUIRED, signals });
      }
      return this.record(valid, {
        state: SafetyPolicyState.RESTRICTED,
        signals,
        restrictions: {
          minimumAge: ADULT_MINIMUM_AGE,
          blockedCountries: [],
          allowedCountries: [],
          requiresWarningText: warningFor(matches),
        },
      });
    }
    if (worst === SafetyTier.CAUTION) {
      return this.record(valid, {
        state: SafetyPolicyState.ALLOWED_WITH_WARNING,
        signals,
        restrictions: {
          blockedCountries: [],
          allowedCountries: [],
          requiresWarningText: warningFor(matches),
        },
      });
    }
    return this.record(valid, { state: SafetyPolicyState.ALLOWED, signals: [] });
  }

  private review(input: SafetyAssessmentInputData, rationale: string): SafetyAssessment {
    return {
      assessmentId: randomUUID(),
      subjectType: typeof input.subjectType === 'string' ? input.subjectType : 'UNKNOWN',
      subjectId: typeof input.subjectId === 'string' ? input.subjectId : 'UNKNOWN',
      subjectContentVersion:
        typeof input.subjectContentVersion === 'string' ? input.subjectContentVersion : 'UNKNOWN',
      state: SafetyPolicyState.REVIEW_REQUIRED,
      signals: [{ category: 'DANGEROUS_PHYSICAL_ACTIVITY', score: 0, rationale }],
      policyVersion: SAFETY_POLICY_VERSION_PHASE02,
      decidedBy: 'RULES',
      assessedAt: new Date().toISOString(),
    };
  }

  private record(
    valid: SafetyAssessmentInput,
    outcome: {
      state: SafetyAssessment['state'];
      signals: SafetyRiskSignal[];
      restrictions?: SafetyRestrictions;
    },
  ): SafetyAssessment {
    return {
      assessmentId: randomUUID(),
      subjectType: valid.subjectType,
      subjectId: valid.subjectId,
      subjectContentVersion: valid.subjectContentVersion,
      state: outcome.state,
      signals: outcome.signals,
      restrictions: outcome.restrictions,
      policyVersion: SAFETY_POLICY_VERSION_PHASE02,
      decidedBy: 'RULES',
      assessedAt: new Date().toISOString(),
    };
  }
}

/** Categories whose prohibited matches are escalated rather than merely rejected. */
const ESCALATION_CATEGORIES: ReadonlySet<string> = new Set([
  'SELF_HARM',
  'MINORS',
  'WEAPONS',
  'VIOLENCE',
]);

const TIER_ORDER: ReadonlyArray<SafetyTier> = [
  SafetyTier.PROHIBITED,
  SafetyTier.REVIEW,
  SafetyTier.ADULT_ONLY,
  SafetyTier.CAUTION,
];

function worstTier(matches: ReadonlyArray<LexiconRule>): SafetyTier | null {
  for (const tier of TIER_ORDER) if (matches.some((m) => m.tier === tier)) return tier;
  return null;
}

function warningFor(matches: ReadonlyArray<LexiconRule>): string | undefined {
  const texts = new Set<string>();
  for (const match of matches) {
    const copy = WARNING_COPY[match.category];
    if (copy) texts.add(copy);
  }
  return texts.size > 0 ? [...texts].join(' ') : undefined;
}

/** One signal per category, keeping the strongest score and its rationale. */
function dedupeSignals(matches: ReadonlyArray<LexiconRule>): SafetyRiskSignal[] {
  const byCategory = new Map<string, SafetyRiskSignal>();
  for (const match of matches) {
    const existing = byCategory.get(match.category);
    if (!existing || existing.score < match.score) {
      byCategory.set(match.category, {
        category: match.category,
        score: match.score,
        rationale: match.rationale,
      });
    }
  }
  return [...byCategory.values()];
}
