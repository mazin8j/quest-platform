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
/**
 * What `OwnerEligibilityPort` says about an owner whose account is in good standing. Named rather
 * than written as a bare `true` so that every existing case reads as "this rule is about something
 * other than the owner's account state", and the P02-41 cases stand out as the ones that are not.
 */
const ELIGIBLE = true;
const INELIGIBLE = false;

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
    canViewSupport: false,
    blocked: false,
    ...overrides,
  };
}

const ANONYMOUS: ViewerContext = {
  accountId: null,
  ageBand: null,
  emailVerified: false,
  countryCode: null,
  canViewSupport: false,
  blocked: false,
};

function eligibility(overrides: Record<string, unknown> = {}): QuestEligibility {
  return questEligibilitySchema.parse(overrides);
}

describe('read access', () => {
  it('gives the owner access in every state', () => {
    for (const state of Object.values(QuestState)) {
      expect(questAccessFor(quest({ state }), viewer({ accountId: OWNER }), ELIGIBLE), state).toBe(
        QuestAccess.OWNER,
      );
    }
  });

  it('gives staff access for support work', () => {
    expect(
      questAccessFor(quest({ state: QuestState.SUSPENDED }), viewer({ canViewSupport: true }), ELIGIBLE),
    ).toBe(QuestAccess.OWNER);
  });

  it('hides — never forbids — an unpublished Quest from everyone else', () => {
    for (const state of [
      QuestState.DRAFT,
      QuestState.IN_REVIEW,
      QuestState.ARCHIVED,
      QuestState.SUSPENDED,
      QuestState.ERASED,
    ]) {
      expect(questAccessFor(quest({ state }), viewer(), ELIGIBLE), state).toBe(QuestAccess.HIDDEN);
      expect(questAccessFor(quest({ state }), ANONYMOUS, ELIGIBLE), state).toBe(QuestAccess.HIDDEN);
    }
  });

  it('hides a PRIVATE Quest even when published', () => {
    expect(questAccessFor(quest({ visibility: 'PRIVATE' }), viewer(), ELIGIBLE)).toBe(
      QuestAccess.HIDDEN,
    );
  });

  it('lets an UNLISTED Quest be read by link but keeps it out of discovery', () => {
    expect(questAccessFor(quest({ visibility: 'UNLISTED' }), viewer(), ELIGIBLE)).toBe(
      QuestAccess.VIEWER,
    );
    expect(isDiscoverable(quest({ visibility: 'UNLISTED' }), NOW)).toBe(false);
  });

  it('takes block precedence over publication', () => {
    expect(questAccessFor(quest(), viewer({ blocked: true }), ELIGIBLE)).toBe(QuestAccess.HIDDEN);
  });

  it('does not let a block hide a Quest from its own owner or from staff', () => {
    expect(questAccessFor(quest(), viewer({ accountId: OWNER, blocked: true }), ELIGIBLE)).toBe(
      QuestAccess.OWNER,
    );
    expect(questAccessFor(quest(), viewer({ canViewSupport: true, blocked: true }), ELIGIBLE)).toBe(
      QuestAccess.OWNER,
    );
  });

  // The owner's account lifecycle governs their published content (audit P02-41 / TD-48).
  it('hides a published Quest whose owner is no longer eligible', () => {
    expect(questAccessFor(quest(), viewer(), INELIGIBLE)).toBe(QuestAccess.HIDDEN);
    expect(questAccessFor(quest(), ANONYMOUS, INELIGIBLE)).toBe(QuestAccess.HIDDEN);
    expect(questAccessFor(quest({ visibility: 'UNLISTED' }), viewer(), INELIGIBLE)).toBe(
      QuestAccess.HIDDEN,
    );
  });

  it('does not hide an ineligible owner Quest from that owner or from support staff', () => {
    // Concealment is from the public, not from the author — who must still be able to see and fix
    // their own work — and not from moderation, which has to be able to look at what it withdrew.
    expect(questAccessFor(quest(), viewer({ accountId: OWNER }), INELIGIBLE)).toBe(
      QuestAccess.OWNER,
    );
    expect(questAccessFor(quest(), viewer({ canViewSupport: true }), INELIGIBLE)).toBe(
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
    ownerEligible: ELIGIBLE,
    now: NOW,
  };

  it('allows an eligible viewer', () => {
    expect(evaluateAcceptEligibility({ ...base, viewer: viewer() })).toEqual({
      eligible: true,
      reasons: [],
      hidden: false,
    });
  });

  // Refusals the caller is entitled to an explanation for: they can see the Quest, they just
  // cannot take it on. These come back as an explained 403.
  const refusals: Array<[string, Record<string, unknown>, string]> = [
    ['an anonymous caller', { viewer: ANONYMOUS }, 'AUTHENTICATION_REQUIRED'],
    ['the owner', { viewer: viewer({ accountId: OWNER }) }, 'OWNER_CANNOT_PARTICIPATE'],
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
      expect(result.hidden).toBe(false);
    });
  }

  // Refusals that must not confirm the Quest exists: the caller could not read it either, so the
  // acceptance endpoint must answer exactly as the read endpoint does (audit P02-01 / P02-06).
  const concealed: Array<[string, Record<string, unknown>]> = [
    ['a blocked viewer', { viewer: viewer({ blocked: true }) }],
    ['someone else draft', { quest: quest({ state: QuestState.DRAFT }) }],
    ['a suspended Quest', { quest: quest({ state: QuestState.SUSPENDED }) }],
    ['an archived Quest', { quest: quest({ state: QuestState.ARCHIVED }) }],
    ['a PRIVATE Quest', { quest: quest({ visibility: 'PRIVATE' }) }],
    // Acceptance must answer exactly as the read endpoint does, so an ineligible owner's Quest is
    // "not found" here too — never "not eligible: OWNER_SUSPENDED" (audit P02-41).
    ['a Quest whose owner is ineligible', { ownerEligible: INELIGIBLE }],
    ['a Quest whose owner state could not be established', { ownerEligible: false }],
    [
      'an age-gated Quest below the viewer band',
      {
        quest: quest({ publishedMinimumAgeBand: 'ADULT' }),
        viewer: viewer({ ageBand: 'TEEN_13_15' }),
        publishedMinimumAgeBand: 'ADULT' as const,
      },
    ],
  ];

  for (const [label, overrides] of concealed) {
    it(`conceals ${label} rather than explaining the refusal`, () => {
      const result = evaluateAcceptEligibility({ ...base, viewer: viewer(), ...overrides });
      expect(result.eligible).toBe(false);
      expect(result.hidden).toBe(true);
      expect(result.reasons).toEqual(['NOT_FOUND']);
    });
  }

  it('refuses a Quest whose blocked-country rule cannot be evaluated for this viewer', () => {
    const result = evaluateAcceptEligibility({
      ...base,
      eligibility: eligibility({ blockedCountries: ['FR'] }),
      viewer: viewer({ countryCode: null }),
    });
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain('COUNTRY_UNKNOWN');
  });

  it('uses the PUBLISHED age band, not the draft content, so an edit cannot loosen the gate', () => {
    // The Quest row says TEEN_13_15 in its (edited) content, but it was published as ADULT: the
    // published band is what governs, and it hides the Quest from a 16-year-old entirely.
    const questRow = quest({ publishedMinimumAgeBand: 'ADULT' });
    const teen = viewer({ ageBand: 'TEEN_16_17' });
    expect(questAccessFor(questRow, teen, ELIGIBLE)).toBe(QuestAccess.HIDDEN);
    const result = evaluateAcceptEligibility({
      ...base,
      quest: questRow,
      eligibility: eligibility({ minimumAgeBand: 'TEEN_13_15' }),
      publishedMinimumAgeBand: 'ADULT',
      viewer: teen,
    });
    expect(result.eligible).toBe(false);
    expect(result.hidden).toBe(true);
    // ...and an adult sees it and is eligible, so the gate is the band and nothing else.
    expect(
      evaluateAcceptEligibility({
        ...base,
        quest: questRow,
        publishedMinimumAgeBand: 'ADULT',
        viewer: viewer({ ageBand: 'ADULT' }),
      }).eligible,
    ).toBe(true);
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
