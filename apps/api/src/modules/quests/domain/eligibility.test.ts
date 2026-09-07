import { QuestState, type QuestEligibility, questEligibilitySchema } from '@quest/types';
import { describe, expect, it } from 'vitest';

import {
  QuestAccess,
  type ViewerContext,
  evaluateAcceptEligibility,
  isDiscoverable,
  questAccessFor,
  withinAvailability,
} from './eligibility';
import type { QuestRecord } from './quest';

const OWNER = '01890000-0000-7000-8000-00000000aaaa';
const VIEWER = '01890000-0000-7000-8000-00000000bbbb';
const NOW = new Date('2026-03-01T12:00:00.000Z');
const HOUR = 3_600_000;

function quest(overrides: Partial<QuestRecord> = {}): QuestRecord {
  return {
    id: '01890000-0000-7000-8000-00000000cccc',
    ownerAccountId: OWNER,
    state: QuestState.PUBLISHED,
    visibility: 'PUBLIC',
    revision: 1,
    title: 't',
    summary: 's',
    instructions: 'i',
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
    contentHash: 'hash',
    publishedVersion: 1,
    publishedContentHash: 'hash',
    publishedAssessmentId: '01890000-0000-7000-8000-00000000dddd',
    publishedAt: new Date('2026-02-20T00:00:00.000Z'),
    publishedMinimumAgeBand: 'TEEN_13_15',
    archivedAt: null,
    suspendedAt: null,
    suspensionReason: null,
    erasedAt: null,
    createdAt: new Date('2026-02-01T00:00:00.000Z'),
    updatedAt: new Date('2026-02-01T00:00:00.000Z'),
    ...overrides,
  };
}

function viewer(overrides: Partial<ViewerContext> = {}): ViewerContext {
  return {
    accountId: VIEWER,
    ageBand: 'ADULT',
    emailVerified: true,
    countryCode: 'JO',
    isStaff: false,
    blocked: false,
    ...overrides,
  };
}

const ANONYMOUS: ViewerContext = {
  accountId: null,
  ageBand: null,
  emailVerified: false,
  countryCode: null,
  isStaff: false,
  blocked: false,
};

function eligibility(overrides: Record<string, unknown> = {}): QuestEligibility {
  return questEligibilitySchema.parse(overrides);
}

describe('read access', () => {
  it('gives the owner access in every state', () => {
    for (const state of Object.values(QuestState)) {
      expect(questAccessFor(quest({ state }), viewer({ accountId: OWNER })), state).toBe(
        QuestAccess.OWNER,
      );
    }
  });

  it('gives staff access for support work', () => {
    expect(questAccessFor(quest({ state: QuestState.SUSPENDED }), viewer({ isStaff: true }))).toBe(
      QuestAccess.OWNER,
    );
  });

  it('hides — never forbids — an unpublished Quest from everyone else', () => {
    for (const state of [
      QuestState.DRAFT,
      QuestState.IN_REVIEW,
      QuestState.ARCHIVED,
      QuestState.SUSPENDED,
      QuestState.ERASED,
    ]) {
      expect(questAccessFor(quest({ state }), viewer()), state).toBe(QuestAccess.HIDDEN);
      expect(questAccessFor(quest({ state }), ANONYMOUS), state).toBe(QuestAccess.HIDDEN);
    }
  });

  it('hides a PRIVATE Quest even when published', () => {
    expect(questAccessFor(quest({ visibility: 'PRIVATE' }), viewer())).toBe(QuestAccess.HIDDEN);
  });

  it('lets an UNLISTED Quest be read by link but keeps it out of discovery', () => {
    expect(questAccessFor(quest({ visibility: 'UNLISTED' }), viewer())).toBe(QuestAccess.VIEWER);
    expect(isDiscoverable(quest({ visibility: 'UNLISTED' }), NOW)).toBe(false);
  });

  it('takes block precedence over publication', () => {
    expect(questAccessFor(quest(), viewer({ blocked: true }))).toBe(QuestAccess.HIDDEN);
  });

  it('does not let a block hide a Quest from its own owner or from staff', () => {
    expect(questAccessFor(quest(), viewer({ accountId: OWNER, blocked: true }))).toBe(
      QuestAccess.OWNER,
    );
    expect(questAccessFor(quest(), viewer({ isStaff: true, blocked: true }))).toBe(
      QuestAccess.OWNER,
    );
  });
});

describe('availability window', () => {
  it('excludes a Quest before it opens and after it closes', () => {
    expect(withinAvailability(quest({ availableFrom: new Date(NOW.getTime() + HOUR) }), NOW)).toBe(
      false,
    );
    expect(withinAvailability(quest({ availableUntil: new Date(NOW.getTime() - HOUR) }), NOW)).toBe(
      false,
    );
    expect(withinAvailability(quest({ availableUntil: NOW }), NOW)).toBe(false);
    expect(
      withinAvailability(
        quest({
          availableFrom: new Date(NOW.getTime() - HOUR),
          availableUntil: new Date(NOW.getTime() + HOUR),
        }),
        NOW,
      ),
    ).toBe(true);
  });

  it('keeps a closed Quest out of discovery', () => {
    expect(isDiscoverable(quest({ availableUntil: new Date(NOW.getTime() - HOUR) }), NOW)).toBe(
      false,
    );
    expect(isDiscoverable(quest(), NOW)).toBe(true);
  });
});

describe('accept eligibility', () => {
  const base = {
    quest: quest(),
    eligibility: eligibility(),
    publishedMinimumAgeBand: 'TEEN_13_15' as const,
    now: NOW,
  };

  it('allows an eligible viewer', () => {
    expect(evaluateAcceptEligibility({ ...base, viewer: viewer() })).toEqual({
      eligible: true,
      reasons: [],
    });
  });

  const refusals: Array<[string, Record<string, unknown>, string]> = [
    ['an anonymous caller', { viewer: ANONYMOUS }, 'AUTHENTICATION_REQUIRED'],
    ['a blocked viewer', { viewer: viewer({ blocked: true }) }, 'BLOCKED'],
    ['the owner', { viewer: viewer({ accountId: OWNER }) }, 'OWNER_CANNOT_PARTICIPATE'],
    ['an unpublished Quest', { quest: quest({ state: QuestState.DRAFT }) }, 'QUEST_NOT_PUBLISHED'],
    ['a suspended Quest', { quest: quest({ state: QuestState.SUSPENDED }) }, 'QUEST_NOT_PUBLISHED'],
    ['an archived Quest', { quest: quest({ state: QuestState.ARCHIVED }) }, 'QUEST_NOT_PUBLISHED'],
    [
      'a closed availability window',
      { quest: quest({ availableUntil: new Date(NOW.getTime() - HOUR) }) },
      'OUTSIDE_AVAILABILITY_WINDOW',
    ],
    [
      'an unverified email when the Quest requires one',
      { viewer: viewer({ emailVerified: false }) },
      'EMAIL_NOT_VERIFIED',
    ],
    [
      'a viewer below the published minimum band',
      { viewer: viewer({ ageBand: 'TEEN_13_15' }), publishedMinimumAgeBand: 'ADULT' as const },
      'AGE_RESTRICTED',
    ],
    [
      'a blocked country',
      { eligibility: eligibility({ blockedCountries: ['JO'] }) },
      'COUNTRY_BLOCKED',
    ],
    [
      'a country outside the allow-list',
      { eligibility: eligibility({ allowedCountries: ['GB'] }) },
      'COUNTRY_NOT_ALLOWED',
    ],
    [
      'an unknown country when an allow-list exists',
      {
        eligibility: eligibility({ allowedCountries: ['GB'] }),
        viewer: viewer({ countryCode: null }),
      },
      'COUNTRY_NOT_ALLOWED',
    ],
  ];

  for (const [label, overrides, reason] of refusals) {
    it(`refuses ${label}`, () => {
      const result = evaluateAcceptEligibility({ ...base, viewer: viewer(), ...overrides });
      expect(result.eligible).toBe(false);
      expect(result.reasons).toContain(reason);
    });
  }

  it('uses the PUBLISHED age band, not the draft content, so an edit cannot loosen the gate', () => {
    // The Quest row says TEEN_13_15 in its (edited) content, but it was published as ADULT.
    const result = evaluateAcceptEligibility({
      ...base,
      eligibility: eligibility({ minimumAgeBand: 'TEEN_13_15' }),
      publishedMinimumAgeBand: 'ADULT',
      viewer: viewer({ ageBand: 'TEEN_16_17' }),
    });
    expect(result.reasons).toContain('AGE_RESTRICTED');
  });

  it('treats a viewer with no known age band as ineligible (fail-closed)', () => {
    const result = evaluateAcceptEligibility({ ...base, viewer: viewer({ ageBand: null }) });
    expect(result.reasons).toContain('AGE_RESTRICTED');
  });

  it('lets a viewer above the minimum band through', () => {
    expect(
      evaluateAcceptEligibility({
        ...base,
        publishedMinimumAgeBand: 'TEEN_16_17',
        viewer: viewer({ ageBand: 'ADULT' }),
      }).eligible,
    ).toBe(true);
  });
});
