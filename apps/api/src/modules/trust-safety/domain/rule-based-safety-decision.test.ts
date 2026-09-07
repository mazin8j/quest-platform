import { type SafetyAssessmentInputData, canPublishWithAssessment } from '@quest/types';
import { describe, expect, it } from 'vitest';

import {
  RuleBasedSafetyDecision,
  SAFETY_POLICY_VERSION_PHASE02,
} from './rule-based-safety-decision';
import { SAFETY_LEXICON, normaliseForMatching } from './safety-lexicon';

const engine = new RuleBasedSafetyDecision();

function input(
  text: Record<string, string>,
  overrides: Partial<SafetyAssessmentInputData> = {},
): SafetyAssessmentInputData {
  return {
    subjectType: 'QUEST',
    subjectId: '01890000-0000-7000-8000-00000000cccc',
    subjectContentVersion: 'hash-1',
    text,
    ...overrides,
  };
}

describe('rule-based safety decision', () => {
  it('allows ordinary, benign content', async () => {
    const result = await engine.assess(
      input({
        title: 'Write a thank-you letter',
        instructions: 'Write a short letter to somebody who helped you this year and post it.',
      }),
    );
    expect(result.state).toBe('ALLOWED');
    expect(result.signals).toEqual([]);
    expect(result.policyVersion).toBe(SAFETY_POLICY_VERSION_PHASE02);
    expect(result.decidedBy).toBe('RULES');
    expect(result.subjectContentVersion).toBe('hash-1');
  });

  it('escalates imminent-harm content instead of merely rejecting it', async () => {
    const result = await engine.assess(
      input({ instructions: 'Hold your breath and cut yourself if you fail the dare.' }),
    );
    expect(result.state).toBe('ESCALATED');
    expect(result.signals.map((s) => s.category)).toContain('SELF_HARM');
  });

  it('rejects prohibited content that is not an escalation category', async () => {
    const result = await engine.assess(input({ instructions: 'Post a nude photo of yourself.' }));
    expect(result.state).toBe('REJECTED');
  });

  it('routes serious risk to human review', async () => {
    for (const text of [
      'Climb the fence into the abandoned building and photograph it.',
      'Walk along the train tracks at sunset.',
      'Shoplift something small and post the receipt.',
    ]) {
      const result = await engine.assess(input({ instructions: text }));
      expect(result.state, text).toBe('REVIEW_REQUIRED');
    }
  });

  it('age-gates adults-only content and attaches warning copy', async () => {
    const result = await engine.assess(
      input({ instructions: 'Visit a local brewery and photograph the beer you try.' }),
    );
    expect(result.state).toBe('RESTRICTED');
    expect(result.restrictions?.minimumAge).toBe(18);
    expect(result.restrictions?.requiresWarningText).toMatch(/alcohol/i);
  });

  it('sends adults-only content to review when the audience may include minors', async () => {
    const result = await engine.assess(
      input(
        { instructions: 'Visit a local brewery and photograph the beer you try.' },
        { audienceIncludesMinors: true },
      ),
    );
    expect(result.state).toBe('REVIEW_REQUIRED');
  });

  it('allows cautionary content with a warning', async () => {
    const result = await engine.assess(
      input({ instructions: 'Hike a local trail and photograph the view from the top.' }),
    );
    expect(result.state).toBe('ALLOWED_WITH_WARNING');
    expect(result.restrictions?.requiresWarningText).toBeTruthy();
    expect(result.restrictions?.minimumAge).toBeUndefined();
  });

  it('lets the most restrictive tier win when several fire', async () => {
    const result = await engine.assess(
      input({
        title: 'Hike at night',
        instructions: 'Hike to the cliff at night, then have a beer, and steal a sign on the way.',
      }),
    );
    expect(result.state).toBe('REVIEW_REQUIRED');
  });

  it('is fail-closed on malformed input: never ALLOWED', async () => {
    const malformed = [
      { subjectType: '', subjectId: 'x', subjectContentVersion: 'v', text: {} },
      { subjectType: 'QUEST', subjectId: 'x', subjectContentVersion: '', text: {} },
      { subjectType: 'QUEST', subjectId: 'x', subjectContentVersion: 'v', text: { a: 1 } },
    ] as unknown as SafetyAssessmentInputData[];
    for (const bad of malformed) {
      const result = await engine.assess(bad);
      expect(result.state).toBe('REVIEW_REQUIRED');
      expect(canPublishWithAssessment(result, result.subjectContentVersion).allowed).toBe(false);
    }
  });

  it('is deterministic: the same text always produces the same decision', async () => {
    const text = { instructions: 'Cycle 10 km and photograph where you stopped.' };
    const [a, b] = await Promise.all([engine.assess(input(text)), engine.assess(input(text))]);
    expect(a.state).toBe(b.state);
    expect(a.signals).toEqual(b.signals);
    // The assessment id is unique per decision: the ledger is append-only.
    expect(a.assessmentId).not.toBe(b.assessmentId);
  });

  it('records one signal per category, keeping the strongest score', async () => {
    const result = await engine.assess(
      input({ instructions: 'Free climb the cliff, then hike back down the trail.' }),
    );
    const categories = result.signals.map((s) => s.category);
    expect(new Set(categories).size).toBe(categories.length);
    const physical = result.signals.find((s) => s.category === 'DANGEROUS_PHYSICAL_ACTIVITY');
    expect(physical?.score).toBe(0.8);
  });

  it('carries no user text into the signals it records', async () => {
    const result = await engine.assess(
      input({ instructions: 'Steal a traffic cone from Elm Street and photograph it.' }),
    );
    for (const signal of result.signals) {
      expect(signal.rationale ?? '').not.toMatch(/elm street/i);
    }
  });
});

describe('safety lexicon', () => {
  it('matches on normalised text, so casing and spacing cannot evade a rule', async () => {
    const spaced = await engine.assess(
      input({ instructions: 'CLIMB   THE\nFENCE into the yard.' }),
    );
    expect(spaced.state).toBe('REVIEW_REQUIRED');
    expect(normaliseForMatching('  A   B \n C ')).toBe('a b c');
  });

  it('keeps every rule anchored so it cannot match ordinary language', () => {
    for (const rule of SAFETY_LEXICON) {
      expect(rule.pattern.source, rule.rationale).toContain('\\b');
      expect(rule.score).toBeGreaterThan(0);
      expect(rule.score).toBeLessThanOrEqual(1);
      expect(rule.rationale.length).toBeLessThanOrEqual(500);
    }
  });

  it('does not fire on everyday Quest language', async () => {
    for (const text of [
      'Cook a meal from a recipe you have never tried and photograph the result.',
      'Read one chapter of a book and write three sentences about it.',
      'Water a neighbour plant while they are away and take a photo.',
    ]) {
      const result = await engine.assess(input({ instructions: text }));
      expect(result.state, text).toBe('ALLOWED');
    }
  });
});
