import { describe, expect, it } from 'vitest';

import type { AssessmentRecord } from './quest';
import { effectiveAssessment, publishedDecisionPublishable } from './safety-precedence';

const QUEST = '01890000-0000-7000-8000-00000000cccc';
const HASH = 'hash-a';
const OTHER_HASH = 'hash-b';

let nextSeq = 0;
function decision(
  overrides: Partial<AssessmentRecord> & Pick<AssessmentRecord, 'state' | 'decidedBy'>,
): AssessmentRecord {
  nextSeq += 1;
  return {
    id: `0189${String(nextSeq).padStart(4, '0')}-0000-7000-8000-00000000dddd`,
    questId: QUEST,
    contentHash: HASH,
    signals: [],
    restrictions: undefined,
    policyVersion: 'test@1',
    assessedAt: new Date('2026-03-01T12:00:00.000Z'),
    seq: nextSeq,
    ...overrides,
  };
}

/**
 * The precedence rule (ADR-015) exists because "greatest seq wins" let a machine overturn a
 * moderator. Each case below is one way that could happen.
 */
describe('effective safety decision', () => {
  it('returns nothing when no decision is about this content', () => {
    expect(effectiveAssessment([], HASH)).toBeNull();
    expect(
      effectiveAssessment([decision({ state: 'ALLOWED', decidedBy: 'RULES' })], OTHER_HASH),
    ).toBeNull();
  });

  it('takes the most recent decision when one source has spoken', () => {
    const first = decision({ state: 'REVIEW_REQUIRED', decidedBy: 'RULES' });
    const second = decision({ state: 'ALLOWED', decidedBy: 'RULES' });
    expect(effectiveAssessment([first, second], HASH)?.id).toBe(second.id);
    // Order of the input array must not matter; `seq` decides.
    expect(effectiveAssessment([second, first], HASH)?.id).toBe(second.id);
  });

  // The defect this rule was written for (final delta audit P1-2).
  it('does not let a later RULES decision overturn a human one', () => {
    const human = decision({ state: 'REVIEW_REQUIRED', decidedBy: 'HUMAN' });
    const machine = decision({ state: 'ALLOWED', decidedBy: 'RULES' });
    expect(effectiveAssessment([human, machine], HASH)?.id).toBe(human.id);
  });

  it('does not let a later AI decision overturn a human one', () => {
    const human = decision({ state: 'REJECTED', decidedBy: 'HUMAN' });
    const ai = decision({ state: 'ALLOWED', decidedBy: 'AI' });
    expect(effectiveAssessment([human, ai], HASH)?.id).toBe(human.id);
  });

  it('does not let a later RULES decision overturn an AI one', () => {
    const ai = decision({ state: 'REJECTED', decidedBy: 'AI' });
    const rules = decision({ state: 'ALLOWED', decidedBy: 'RULES' });
    expect(effectiveAssessment([ai, rules], HASH)?.id).toBe(ai.id);
  });

  it('lets a later human decision supersede an earlier human decision, in both directions', () => {
    const block = decision({ state: 'REJECTED', decidedBy: 'HUMAN' });
    const clear = decision({ state: 'ALLOWED', decidedBy: 'HUMAN' });
    expect(effectiveAssessment([block, clear], HASH)?.id).toBe(clear.id);

    const clearFirst = decision({ state: 'ALLOWED', decidedBy: 'HUMAN' });
    const blockSecond = decision({ state: 'REJECTED', decidedBy: 'HUMAN' });
    expect(effectiveAssessment([clearFirst, blockSecond], HASH)?.id).toBe(blockSecond.id);
  });

  it('is not "the latest blocking decision wins"', () => {
    // A moderator who reviews content and clears it must be able to release it, or refusal is the
    // only human action the system respects.
    const machineBlock = decision({ state: 'REJECTED', decidedBy: 'RULES' });
    const humanClear = decision({ state: 'ALLOWED', decidedBy: 'HUMAN' });
    const laterMachineBlock = decision({ state: 'REJECTED', decidedBy: 'RULES' });
    expect(effectiveAssessment([machineBlock, humanClear, laterMachineBlock], HASH)?.id).toBe(
      humanClear.id,
    );
  });

  it('ignores decisions about other content entirely', () => {
    // A human block on the OLD content must not answer for new content: the owner edited, nobody
    // has judged what they now have, and `null` is what makes the publish gate say so (ADR-013).
    const humanOnOldContent = decision({
      state: 'REJECTED',
      decidedBy: 'HUMAN',
      contentHash: OTHER_HASH,
    });
    const rulesOnNewContent = decision({ state: 'ALLOWED', decidedBy: 'RULES' });
    expect(effectiveAssessment([humanOnOldContent, rulesOnNewContent], HASH)?.id).toBe(
      rulesOnNewContent.id,
    );
    expect(effectiveAssessment([rulesOnNewContent], OTHER_HASH)).toBeNull();
  });

  it('gives an unrecognised decider the lowest authority, not the highest', () => {
    // A new decider must be granted standing deliberately. Inheriting it by being unknown is the
    // fail-open direction.
    const unknown = decision({
      state: 'ALLOWED',
      decidedBy: 'ORACLE' as AssessmentRecord['decidedBy'],
    });
    const rules = decision({ state: 'REJECTED', decidedBy: 'RULES' });
    expect(effectiveAssessment([unknown, rules], HASH)?.id).toBe(rules.id);
  });
});

describe('published decision gate', () => {
  const published = { state: 'PUBLISHED', publishedContentHash: HASH };

  it('does not apply to a Quest that is not published', () => {
    expect(publishedDecisionPublishable({ state: 'DRAFT', publishedContentHash: null }, [])).toBe(
      null,
    );
    expect(
      publishedDecisionPublishable({ state: 'IN_REVIEW', publishedContentHash: null }, []),
    ).toBe(null);
  });

  it('permits a published Quest whose decision in force allows it', () => {
    expect(
      publishedDecisionPublishable(published, [decision({ state: 'ALLOWED', decidedBy: 'RULES' })]),
    ).toBe(true);
    expect(
      publishedDecisionPublishable(published, [
        decision({ state: 'ALLOWED_WITH_WARNING', decidedBy: 'RULES' }),
      ]),
    ).toBe(true);
  });

  const blockingStates = ['REJECTED', 'REVIEW_REQUIRED', 'ESCALATED', 'UNASSESSED'] as const;
  for (const state of blockingStates) {
    it(`refuses a published Quest whose decision in force is ${state}`, () => {
      expect(
        publishedDecisionPublishable(published, [decision({ state, decidedBy: 'HUMAN' })]),
      ).toBe(false);
    });
  }

  it('refuses when a human block is followed by a machine allow', () => {
    expect(
      publishedDecisionPublishable(published, [
        decision({ state: 'REJECTED', decidedBy: 'HUMAN' }),
        decision({ state: 'ALLOWED', decidedBy: 'RULES' }),
      ]),
    ).toBe(false);
  });

  it('fails closed when a published Quest has no decision about its published content', () => {
    // The database CHECK makes this impossible, so reaching it means an invariant is already
    // broken — and a broken invariant conceals rather than publishes.
    expect(publishedDecisionPublishable(published, [])).toBe(false);
    expect(
      publishedDecisionPublishable(published, [
        decision({ state: 'ALLOWED', decidedBy: 'HUMAN', contentHash: OTHER_HASH }),
      ]),
    ).toBe(false);
  });
});
