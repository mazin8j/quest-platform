import { AccountState } from '@quest/types';
import { describe, expect, it } from 'vitest';

import { isPublicationEligibleState } from './owner-eligibility.port';

/**
 * The publication-eligibility policy, stated once as a table.
 *
 * This test is the reason the policy is a pure function rather than a condition buried in a
 * service: the rule that decides whether a suspended author's Quests stay public should be
 * readable, enumerable over the whole lifecycle, and impossible to extend by accident
 * (audit P02-41 / TD-48, ADR-014).
 */
describe('publication eligibility', () => {
  it('admits ACTIVE accounts and nothing else', () => {
    const eligible = Object.values(AccountState).filter((state) =>
      isPublicationEligibleState(state),
    );
    expect(eligible).toEqual([AccountState.ACTIVE]);
  });

  // Spelled out per state as well as by exhaustion, so a future state added to the enum cannot
  // quietly satisfy the assertion above by also being added to the allow-list.
  const cases: Array<[string, boolean]> = [
    [AccountState.ACTIVE, true],
    [AccountState.PENDING_VERIFICATION, false],
    [AccountState.SUSPENDED, false],
    [AccountState.DEACTIVATED, false],
    [AccountState.DELETION_REQUESTED, false],
    [AccountState.DELETED, false],
  ];

  for (const [state, expected] of cases) {
    it(`${expected ? 'admits' : 'conceals'} ${state}`, () => {
      expect(isPublicationEligibleState(state)).toBe(expected);
    });
  }

  it('fails closed on a state it has never heard of', () => {
    // A lifecycle state added to Identity without a decision here must conceal content, not
    // publish it. Concealment is reversible; disclosure is not.
    expect(isPublicationEligibleState('SOME_FUTURE_STATE')).toBe(false);
    expect(isPublicationEligibleState('')).toBe(false);
  });
});
