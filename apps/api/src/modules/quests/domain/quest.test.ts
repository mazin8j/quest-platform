import { QuestState, type QuestContent, questContentSchema } from '@quest/types';
import { describe, expect, it } from 'vitest';

import {
  type AssessmentRecord,
  type PublishGateInput,
  type QuestRecord,
  effectiveCountryRules,
  evaluatePublish,
  questContentHash,
  transitionQuest,
} from './quest';

const OWNER = '01890000-0000-7000-8000-00000000aaaa';
const OTHER = '01890000-0000-7000-8000-00000000bbbb';
const QUEST_ID = '01890000-0000-7000-8000-00000000cccc';
const DAY_MS = 86_400_000;
const NOW = new Date('2026-03-01T12:00:00.000Z');

function content(overrides: Record<string, unknown> = {}): QuestContent {
  return questContentSchema.parse({
    title: 'Litter sweep in the park',
    summary: 'Collect a bag of litter from your local park and photograph the result.',
    instructions:
      'Bring gloves and a bag. Spend twenty minutes collecting litter along one path. Dispose of it in a public bin.',
    categoryKey: 'environment',
    difficulty: 'EASY',
    evidence: { types: ['PHOTO'] },
    eligibility: {},
    ...overrides,
  });
}

const HASH = questContentHash(content());

function quest(overrides: Partial<QuestRecord> = {}): QuestRecord {
  return {
    id: QUEST_ID,
    ownerAccountId: OWNER,
    state: QuestState.DRAFT,
    visibility: 'PUBLIC',
    revision: 1,
    title: 'Litter sweep in the park',
    summary: 'Collect a bag of litter.',
    instructions: 'Bring gloves.',
    safetyNotes: null,
    categoryKey: 'environment',
    difficulty: 'EASY',
    evidence: {},
    eligibility: {},
    locationCountryCode: null,
    locationLabel: null,
    effortMinutes: 20,
    completionWindowHours: 24,
    availableFrom: null,
    availableUntil: null,
    contentHash: HASH,
    publishedVersion: null,
    publishedContentHash: null,
    publishedAssessmentId: null,
    publishedAt: null,
    publishedMinimumAgeBand: null,
    archivedAt: null,
    suspendedAt: null,
    suspensionReason: null,
    erasedAt: null,
    createdAt: new Date('2026-02-01T00:00:00.000Z'),
    updatedAt: new Date('2026-02-01T00:00:00.000Z'),
    ...overrides,
  };
}

function assessment(overrides: Partial<AssessmentRecord> = {}): AssessmentRecord {
  return {
    id: '01890000-0000-7000-8000-00000000dddd',
    questId: QUEST_ID,
    contentHash: HASH,
    state: 'ALLOWED',
    signals: [],
    restrictions: undefined,
    policyVersion: 'quest-safety-policy@1',
    decidedBy: 'RULES',
    assessedAt: new Date(NOW.getTime() - DAY_MS),
    ...overrides,
  };
}

function gate(overrides: Partial<PublishGateInput> = {}): PublishGateInput {
  return {
    quest: quest(),
    latestAssessment: assessment(),
    declaredMinimumAgeBand: 'TEEN_13_15',
    owner: { accountId: OWNER, state: 'ACTIVE', emailVerified: true },
    actorAccountId: OWNER,
    expectedContentHash: HASH,
    maxAssessmentAgeMs: 30 * DAY_MS,
    now: NOW,
    ...overrides,
  };
}

describe('content hash', () => {
  it('is a stable sha256 of the canonical content', () => {
    expect(HASH).toMatch(/^[0-9a-f]{64}$/);
    expect(questContentHash(content())).toBe(HASH);
  });

  it('changes when safety-relevant content changes', () => {
    expect(
      questContentHash(content({ instructions: 'Climb the fence and take a photo there.' })),
    ).not.toBe(HASH);
  });
});

describe('transitionQuest', () => {
  it('returns the next state for a legal transition', () => {
    expect(transitionQuest(QuestState.DRAFT, 'PUBLISH')).toBe(QuestState.PUBLISHED);
  });

  it('throws CONFLICT for an illegal one rather than assigning a state', () => {
    expect(() => transitionQuest(QuestState.ARCHIVED, 'PUBLISH')).toThrow(/Cannot publish/i);
    expect(() => transitionQuest(QuestState.ERASED, 'REVISE')).toThrow();
  });
});

describe('publish gate', () => {
  it('allows a compliant publish', () => {
    const decision = evaluatePublish(gate());
    expect(decision).toEqual({ allowed: true, blockers: [], minimumAgeBand: 'TEEN_13_15' });
  });

  // Each of these is a separate, independently sufficient reason to refuse.
  const refusals: Array<[string, Partial<PublishGateInput>, string]> = [
    ['a non-owner', { actorAccountId: OTHER }, 'NOT_OWNER'],
    [
      'a suspended owner',
      { owner: { accountId: OWNER, state: 'SUSPENDED', emailVerified: true } },
      'OWNER_NOT_ACTIVE',
    ],
    [
      'an unverified owner',
      { owner: { accountId: OWNER, state: 'ACTIVE', emailVerified: false } },
      'OWNER_EMAIL_NOT_VERIFIED',
    ],
    [
      'a Quest in review',
      { quest: quest({ state: QuestState.IN_REVIEW }) },
      'INVALID_STATE_IN_REVIEW',
    ],
    [
      'an archived Quest',
      { quest: quest({ state: QuestState.ARCHIVED }) },
      'INVALID_STATE_ARCHIVED',
    ],
    [
      'a suspended Quest',
      { quest: quest({ state: QuestState.SUSPENDED }) },
      'INVALID_STATE_SUSPENDED',
    ],
    ['an erased Quest', { quest: quest({ state: QuestState.ERASED }) }, 'INVALID_STATE_ERASED'],
    ['a stale client hash', { expectedContentHash: 'deadbeef' }, 'CONTENT_HASH_MISMATCH'],
    ['no assessment at all', { latestAssessment: null }, 'NO_SAFETY_ASSESSMENT'],
    [
      'an assessment of different content',
      { latestAssessment: assessment({ contentHash: 'other-hash' }) },
      'SAFETY_ASSESSMENT_STALE',
    ],
    [
      'an assessment older than the maximum age',
      { latestAssessment: assessment({ assessedAt: new Date(NOW.getTime() - 31 * DAY_MS) }) },
      'SAFETY_ASSESSMENT_EXPIRED',
    ],
    [
      'an unassessed decision',
      { latestAssessment: assessment({ state: 'UNASSESSED' }) },
      'SAFETY_UNASSESSED',
    ],
    [
      'a decision requiring human review',
      { latestAssessment: assessment({ state: 'REVIEW_REQUIRED' }) },
      'SAFETY_REVIEW_REQUIRED',
    ],
    [
      'a rejected decision',
      { latestAssessment: assessment({ state: 'REJECTED' }) },
      'SAFETY_REJECTED',
    ],
    [
      'an escalated decision',
      { latestAssessment: assessment({ state: 'ESCALATED' }) },
      'SAFETY_ESCALATED',
    ],
  ];

  for (const [label, overrides, blocker] of refusals) {
    it(`refuses ${label}`, () => {
      const decision = evaluatePublish(gate(overrides));
      expect(decision.allowed).toBe(false);
      expect(decision.blockers).toContain(blocker);
    });
  }

  it('reports every blocker at once so the owner can fix them together', () => {
    const decision = evaluatePublish(
      gate({
        actorAccountId: OTHER,
        owner: { accountId: OWNER, state: 'SUSPENDED', emailVerified: false },
        latestAssessment: null,
      }),
    );
    expect(decision.blockers).toEqual(
      expect.arrayContaining([
        'NOT_OWNER',
        'OWNER_NOT_ACTIVE',
        'OWNER_EMAIL_NOT_VERIFIED',
        'NO_SAFETY_ASSESSMENT',
      ]),
    );
  });

  it('allows the conditional safety states the shared rule permits', () => {
    for (const state of ['ALLOWED', 'ALLOWED_WITH_WARNING', 'RESTRICTED'] as const) {
      expect(
        evaluatePublish(gate({ latestAssessment: assessment({ state }) })).allowed,
        state,
      ).toBe(true);
    }
  });

  it('tightens the age band to the assessment restriction, never loosens it', () => {
    const restricted = evaluatePublish(
      gate({
        latestAssessment: assessment({
          state: 'RESTRICTED',
          restrictions: { minimumAge: 18, blockedCountries: [], allowedCountries: [] },
        }),
      }),
    );
    expect(restricted.allowed).toBe(true);
    expect(restricted.minimumAgeBand).toBe('ADULT');

    const ownerStricter = evaluatePublish(
      gate({
        declaredMinimumAgeBand: 'ADULT',
        latestAssessment: assessment({
          state: 'RESTRICTED',
          restrictions: { minimumAge: 13, blockedCountries: [], allowedCountries: [] },
        }),
      }),
    );
    expect(ownerStricter.minimumAgeBand).toBe('ADULT');
  });

  it('is fail-closed by construction: no input combination publishes without an assessment', () => {
    for (const state of Object.values(QuestState)) {
      const decision = evaluatePublish(gate({ quest: quest({ state }), latestAssessment: null }));
      expect(decision.allowed, state).toBe(false);
    }
  });
});

describe('effective country rules', () => {
  it('unions blocked countries from the owner and the assessment', () => {
    const rules = effectiveCountryRules(
      { allowedCountries: [], blockedCountries: ['US'] },
      assessment({
        restrictions: { minimumAge: undefined, blockedCountries: ['FR'], allowedCountries: [] },
      }),
    );
    expect(rules.blockedCountries).toEqual(['FR', 'US']);
    expect(rules.allowedCountries).toEqual([]);
  });

  it('intersects allow-lists so an assessment can only narrow availability', () => {
    const rules = effectiveCountryRules(
      { allowedCountries: ['GB', 'JO', 'US'], blockedCountries: [] },
      assessment({
        restrictions: {
          minimumAge: undefined,
          blockedCountries: [],
          allowedCountries: ['GB', 'JO'],
        },
      }),
    );
    expect(rules.allowedCountries).toEqual(['GB', 'JO']);
  });

  it('adopts the assessment allow-list when the owner declared none', () => {
    const rules = effectiveCountryRules(
      { allowedCountries: [], blockedCountries: [] },
      assessment({
        restrictions: { minimumAge: undefined, blockedCountries: [], allowedCountries: ['JO'] },
      }),
    );
    expect(rules.allowedCountries).toEqual(['JO']);
  });

  it('passes the declared rules through when there is no assessment', () => {
    expect(
      effectiveCountryRules({ allowedCountries: ['JO'], blockedCountries: ['US'] }, null),
    ).toEqual({ allowedCountries: ['JO'], blockedCountries: ['US'] });
  });
});
