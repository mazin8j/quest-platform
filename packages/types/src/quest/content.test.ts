import { describe, expect, it } from 'vitest';

import {
  QUEST_CONTENT_HASH_VERSION,
  type QuestContent,
  ageBandForMinimumAge,
  ageBandSatisfies,
  canonicalQuestContent,
  questContentSchema,
  questDurationSchema,
  questEligibilitySchema,
  strictestAgeBand,
} from './content';

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

describe('canonical Quest content', () => {
  it('is stable for equal content regardless of key order', () => {
    const a = canonicalQuestContent(content());
    const b = canonicalQuestContent(content());
    expect(a).toBe(b);
    expect(a.startsWith(`v=${QUEST_CONTENT_HASH_VERSION}\n`)).toBe(true);
  });

  it('normalises insignificant whitespace but preserves case', () => {
    const spaced = canonicalQuestContent(content({ title: '  Litter   sweep in the   park ' }));
    expect(spaced).toBe(canonicalQuestContent(content()));
    expect(canonicalQuestContent(content({ title: 'LITTER SWEEP IN THE PARK' }))).not.toBe(
      canonicalQuestContent(content()),
    );
  });

  it('ignores the order of set-like fields', () => {
    const one = content({ evidence: { types: ['PHOTO', 'TEXT_NOTE'] } });
    const other = content({ evidence: { types: ['TEXT_NOTE', 'PHOTO'] } });
    expect(canonicalQuestContent(one)).toBe(canonicalQuestContent(other));

    const allowedA = content({ eligibility: { allowedCountries: ['GB', 'JO'] } });
    const allowedB = content({ eligibility: { allowedCountries: ['JO', 'GB'] } });
    expect(canonicalQuestContent(allowedA)).toBe(canonicalQuestContent(allowedB));
  });

  it('changes when any safety-relevant field changes', () => {
    const base = canonicalQuestContent(content());
    const variants = [
      content({ title: 'Litter sweep in the woods' }),
      content({ summary: 'Collect two bags of litter from your local park and photograph them.' }),
      content({
        instructions:
          'Bring gloves and a bag. Spend forty minutes collecting litter along the riverbank instead.',
      }),
      content({ safetyNotes: 'Do not handle broken glass.' }),
      content({ categoryKey: 'community' }),
      content({ difficulty: 'HARD' }),
      content({ evidence: { types: ['VIDEO'] } }),
      content({ evidence: { types: ['PHOTO'], minimumItems: 3 } }),
      content({ evidence: { types: ['PHOTO'], requiresLocationAttestation: true } }),
      content({ eligibility: { minimumAgeBand: 'ADULT' } }),
      content({ eligibility: { requiresVerifiedEmail: false } }),
      content({ eligibility: { blockedCountries: ['US'] } }),
      content({ location: { countryCode: 'JO' } }),
      content({ location: { label: 'Amman' } }),
    ];
    for (const variant of variants) {
      expect(canonicalQuestContent(variant), JSON.stringify(variant.title)).not.toBe(base);
    }
    expect(new Set(variants.map(canonicalQuestContent)).size).toBe(variants.length);
  });

  it('does not change when a non-safety-relevant field changes', () => {
    // Duration is not part of the content schema at all: re-planning must not void an approval.
    expect(Object.keys(content())).not.toContain('duration');
  });
});

describe('Quest duration', () => {
  it('keeps effort, attempt window and availability as three separate concepts', () => {
    const parsed = questDurationSchema.parse({ effortMinutes: 30 });
    expect(parsed).toEqual({ effortMinutes: 30, completionWindowHours: 24 });
  });

  it('rejects an availability window that ends before it starts', () => {
    expect(() =>
      questDurationSchema.parse({
        effortMinutes: 30,
        availableFrom: '2026-01-02T00:00:00.000Z',
        availableUntil: '2026-01-01T00:00:00.000Z',
      }),
    ).toThrow();
  });

  it('bounds effort and the completion window', () => {
    expect(() => questDurationSchema.parse({ effortMinutes: 1 })).toThrow();
    expect(() => questDurationSchema.parse({ effortMinutes: 600 })).toThrow();
    expect(() =>
      questDurationSchema.parse({ effortMinutes: 30, completionWindowHours: 0 }),
    ).toThrow();
    expect(() =>
      questDurationSchema.parse({ effortMinutes: 30, completionWindowHours: 24 * 31 }),
    ).toThrow();
  });
});

describe('age bands', () => {
  it('orders bands from least to most restrictive', () => {
    expect(ageBandSatisfies('ADULT', 'TEEN_13_15')).toBe(true);
    expect(ageBandSatisfies('TEEN_16_17', 'TEEN_13_15')).toBe(true);
    expect(ageBandSatisfies('TEEN_13_15', 'TEEN_16_17')).toBe(false);
    expect(ageBandSatisfies('TEEN_16_17', 'ADULT')).toBe(false);
  });

  it('folds two constraints to the stricter one', () => {
    expect(strictestAgeBand('TEEN_13_15', 'ADULT')).toBe('ADULT');
    expect(strictestAgeBand('ADULT', 'TEEN_16_17')).toBe('ADULT');
    expect(strictestAgeBand('TEEN_13_15', 'TEEN_13_15')).toBe('TEEN_13_15');
  });

  it('maps a minimum age to the band that satisfies it', () => {
    expect(ageBandForMinimumAge(21)).toBe('ADULT');
    expect(ageBandForMinimumAge(18)).toBe('ADULT');
    expect(ageBandForMinimumAge(17)).toBe('TEEN_16_17');
    expect(ageBandForMinimumAge(16)).toBe('TEEN_16_17');
    expect(ageBandForMinimumAge(13)).toBe('TEEN_13_15');
  });
});

describe('eligibility defaults', () => {
  it('defaults to the least restrictive band and a verified email', () => {
    expect(questEligibilitySchema.parse({})).toEqual({
      minimumAgeBand: 'TEEN_13_15',
      requiresVerifiedEmail: true,
      allowedCountries: [],
      blockedCountries: [],
    });
  });

  it('rejects malformed country codes', () => {
    expect(() => questEligibilitySchema.parse({ allowedCountries: ['gb'] })).toThrow();
    expect(() => questEligibilitySchema.parse({ blockedCountries: ['GBR'] })).toThrow();
  });
});
