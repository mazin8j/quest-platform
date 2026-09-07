import { describe, expect, it } from 'vitest';

import {
  describeEligibilityReason,
  describePublishBlocker,
  describePublishBlockers,
  publishSummary,
} from './publish-blockers';
import { EMPTY_QUEST_FORM, toCreateRequest, validateQuestForm } from './quest-form';

const valid = {
  ...EMPTY_QUEST_FORM,
  title: 'Plant something and watch it grow',
  summary: 'Plant one seed or seedling somewhere it can live, and photograph it.',
  instructions:
    'Choose a pot or a patch of soil, plant one seed, water it, and photograph it where it now lives.',
  categoryKey: 'environment',
};

describe('publish blockers', () => {
  it('explains every blocker the publish gate can return', () => {
    // The full set the domain gate emits (apps/api/src/modules/quests/domain/quest.ts).
    const codes = [
      'NOT_OWNER',
      'OWNER_NOT_ACTIVE',
      'OWNER_EMAIL_NOT_VERIFIED',
      'INVALID_STATE_IN_REVIEW',
      'INVALID_STATE_PUBLISHED',
      'INVALID_STATE_ARCHIVED',
      'INVALID_STATE_SUSPENDED',
      'INVALID_STATE_ERASED',
      'CONTENT_HASH_MISMATCH',
      'NO_SAFETY_ASSESSMENT',
      'SAFETY_ASSESSMENT_STALE',
      'SAFETY_ASSESSMENT_EXPIRED',
      'SAFETY_UNASSESSED',
      'SAFETY_REVIEW_REQUIRED',
      'SAFETY_REJECTED',
      'SAFETY_ESCALATED',
    ];
    for (const code of codes) {
      const copy = describePublishBlocker(code);
      expect(copy, code).not.toBe('');
      // Never show the raw code to an author.
      expect(copy, code).not.toContain('_');
    }
  });

  it('falls back safely for a code it has never seen rather than hiding it', () => {
    expect(describePublishBlocker('SOMETHING_NEW')).toBe('This Quest cannot be published yet.');
    expect(describePublishBlocker('INVALID_STATE_FUTURE')).toBe(
      'This Quest cannot be published yet.',
    );
  });

  it('de-duplicates sentences and reports readiness only on an empty list', () => {
    expect(describePublishBlockers(['SAFETY_REJECTED', 'SAFETY_REJECTED'])).toHaveLength(1);
    expect(describePublishBlockers(null)).toEqual([]);
    expect(publishSummary([])).toBe('Ready to publish');
    expect(publishSummary(null)).toBe('');
    expect(publishSummary(['NO_SAFETY_ASSESSMENT'])).toMatch(/safety check/i);
  });
});

describe('eligibility reasons', () => {
  it('explains a refusal without revealing anything about the viewer', () => {
    for (const code of [
      'AUTHENTICATION_REQUIRED',
      'BLOCKED',
      'OWNER_CANNOT_PARTICIPATE',
      'QUEST_NOT_PUBLISHED',
      'OUTSIDE_AVAILABILITY_WINDOW',
      'EMAIL_NOT_VERIFIED',
      'AGE_RESTRICTED',
      'COUNTRY_BLOCKED',
      'COUNTRY_NOT_ALLOWED',
    ]) {
      const copy = describeEligibilityReason(code);
      expect(copy, code).not.toBe('');
      expect(copy.toLowerCase(), code).not.toMatch(/birth|age \d|years old/);
    }
    expect(describeEligibilityReason('UNKNOWN')).toBe('You cannot accept this Quest right now.');
  });
});

describe('quest composer validation', () => {
  it('accepts a complete Quest', () => {
    expect(validateQuestForm(valid)).toEqual({ ok: true, errors: {} });
  });

  it('reports a message per field rather than one opaque failure', () => {
    const result = validateQuestForm(EMPTY_QUEST_FORM);
    expect(result.ok).toBe(false);
    expect(Object.keys(result.errors)).toEqual(
      expect.arrayContaining(['title', 'summary', 'instructions', 'categoryKey']),
    );
  });

  it('bounds effort and the completion window with the shared contract limits', () => {
    expect(validateQuestForm({ ...valid, effortMinutes: '1' }).errors.effortMinutes).toBeDefined();
    expect(
      validateQuestForm({ ...valid, effortMinutes: '600' }).errors.effortMinutes,
    ).toBeDefined();
    expect(
      validateQuestForm({ ...valid, completionWindowHours: '0' }).errors.completionWindowHours,
    ).toBeDefined();
    expect(
      validateQuestForm({ ...valid, completionWindowHours: '2.5' }).errors.completionWindowHours,
    ).toBeDefined();
  });

  it('builds a request that carries no ownership or state fields', () => {
    const request = toCreateRequest(valid) as Record<string, unknown>;
    expect(Object.keys(request).sort()).toEqual(['content', 'duration', 'visibility']);
    expect(JSON.stringify(request)).not.toContain('ownerAccountId');
    expect(JSON.stringify(request)).not.toContain('state');
  });

  it('carries the author own audience choice rather than hardcoding the loosest band', () => {
    expect(toCreateRequest(valid).content.eligibility.minimumAgeBand).toBe('TEEN_13_15');
    expect(
      toCreateRequest({ ...valid, minimumAgeBand: 'ADULT' }).content.eligibility.minimumAgeBand,
    ).toBe('ADULT');
    expect(validateQuestForm({ ...valid, minimumAgeBand: 'GROWN_UPS' }).ok).toBe(false);
  });

  it('omits empty safety notes instead of sending an empty string', () => {
    expect(toCreateRequest(valid).content.safetyNotes).toBeUndefined();
    expect(toCreateRequest({ ...valid, safetyNotes: 'Wear gloves.' }).content.safetyNotes).toBe(
      'Wear gloves.',
    );
  });
});
