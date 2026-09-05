import { describe, expect, it } from 'vitest';

import {
  SafetyPolicyState,
  SafetyRiskCategory,
  canPublishWithAssessment,
  canPublishWithSafetyState,
  safetyAssessmentInputSchema,
  safetyAssessmentSchema,
  type SafetyAssessment,
} from './safety';

const baseAssessment: SafetyAssessment = {
  assessmentId: '018f3f2e-9c1e-7c8a-b4a5-0f1e2d3c4b5a',
  subjectType: 'QUEST',
  subjectId: 'quest-1',
  subjectContentVersion: 'sha256:abc',
  state: SafetyPolicyState.ALLOWED,
  signals: [],
  policyVersion: 'quest-safety-policy@1',
  decidedBy: 'RULES',
  assessedAt: '2026-09-04T00:00:00.000Z',
};

describe('canPublishWithSafetyState — the deterministic publish rule', () => {
  it('permits only ALLOWED, ALLOWED_WITH_WARNING and RESTRICTED', () => {
    expect(canPublishWithSafetyState(SafetyPolicyState.ALLOWED)).toBe(true);
    expect(canPublishWithSafetyState(SafetyPolicyState.ALLOWED_WITH_WARNING)).toBe(true);
    expect(canPublishWithSafetyState(SafetyPolicyState.RESTRICTED)).toBe(true);
  });

  it('is fail-closed for every non-publishable state', () => {
    expect(canPublishWithSafetyState(SafetyPolicyState.UNASSESSED)).toBe(false);
    expect(canPublishWithSafetyState(SafetyPolicyState.REVIEW_REQUIRED)).toBe(false);
    expect(canPublishWithSafetyState(SafetyPolicyState.REJECTED)).toBe(false);
    expect(canPublishWithSafetyState(SafetyPolicyState.ESCALATED)).toBe(false);
  });

  it('covers every enum member (guards against a new state silently becoming publishable)', () => {
    const decided = Object.values(SafetyPolicyState).map((s) => canPublishWithSafetyState(s));
    expect(decided.filter(Boolean)).toHaveLength(3);
    expect(decided).toHaveLength(7);
  });
});

describe('canPublishWithAssessment — staleness and absence', () => {
  it('rejects a missing assessment', () => {
    const r = canPublishWithAssessment(null, 'sha256:abc');
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/UNASSESSED/);
  });

  it('rejects an assessment for a different content version', () => {
    const r = canPublishWithAssessment(baseAssessment, 'sha256:changed');
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/stale/i);
  });

  it('rejects a matching assessment whose state is not publishable', () => {
    const r = canPublishWithAssessment(
      { ...baseAssessment, state: SafetyPolicyState.REVIEW_REQUIRED },
      'sha256:abc',
    );
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain('REVIEW_REQUIRED');
  });

  it('allows a fresh, publishable assessment', () => {
    expect(canPublishWithAssessment(baseAssessment, 'sha256:abc').allowed).toBe(true);
  });
});

describe('safety schemas', () => {
  it('validates a complete assessment and rejects unknown states', () => {
    expect(safetyAssessmentSchema.safeParse(baseAssessment).success).toBe(true);
    expect(safetyAssessmentSchema.safeParse({ ...baseAssessment, state: 'MAYBE' }).success).toBe(
      false,
    );
  });

  it('bounds risk scores to [0, 1] and requires known categories', () => {
    const ok = safetyAssessmentSchema.safeParse({
      ...baseAssessment,
      signals: [{ category: SafetyRiskCategory.DANGEROUS_DRIVING, score: 0.7 }],
    });
    expect(ok.success).toBe(true);
    const badScore = safetyAssessmentSchema.safeParse({
      ...baseAssessment,
      signals: [{ category: SafetyRiskCategory.DANGEROUS_DRIVING, score: 1.5 }],
    });
    expect(badScore.success).toBe(false);
    const badCategory = safetyAssessmentSchema.safeParse({
      ...baseAssessment,
      signals: [{ category: 'JAYWALKING', score: 0.1 }],
    });
    expect(badCategory.success).toBe(false);
  });

  it('input never accepts precise coordinates — only a country code', () => {
    const parsed = safetyAssessmentInputSchema.safeParse({
      subjectType: 'QUEST',
      subjectId: 'q1',
      subjectContentVersion: 'v1',
      text: { title: 'Climb the water tower at night' },
      countryCode: 'JO',
    });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.audienceIncludesMinors).toBe(false);
    const bad = safetyAssessmentInputSchema.safeParse({
      subjectType: 'QUEST',
      subjectId: 'q1',
      subjectContentVersion: 'v1',
      text: {},
      countryCode: '31.95,35.93',
    });
    expect(bad.success).toBe(false);
  });

  it('enumerates all thirteen mandated risk categories plus platform additions', () => {
    const mandated = [
      'DANGEROUS_PHYSICAL_ACTIVITY',
      'ILLEGAL_BEHAVIOR',
      'SELF_HARM',
      'VIOLENCE',
      'DRUGS',
      'ALCOHOL',
      'DANGEROUS_DRIVING',
      'MINORS',
      'BULLYING',
      'HARASSMENT',
      'SEXUAL_CONTENT',
      'DANGEROUS_LOCATION',
      'TRESPASSING',
    ];
    for (const c of mandated) {
      expect(Object.values(SafetyRiskCategory)).toContain(c);
    }
  });
});
