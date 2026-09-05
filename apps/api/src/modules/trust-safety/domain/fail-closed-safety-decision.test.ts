import {
  SafetyPolicyState,
  canPublishWithAssessment,
  canPublishWithSafetyState,
} from '@quest/types';
import { describe, expect, it } from 'vitest';

import {
  FailClosedSafetyDecision,
  SAFETY_POLICY_VERSION_PHASE00,
} from './fail-closed-safety-decision';

describe('FailClosedSafetyDecision (Phase 00 enforcement point)', () => {
  const port = new FailClosedSafetyDecision();
  const input = {
    subjectType: 'QUEST',
    subjectId: 'q-1',
    subjectContentVersion: 'sha256:1',
    text: { title: 'Walk 10,000 steps today' },
  };

  it('routes even harmless content to human review — never ALLOWED by default', async () => {
    const a = await port.assess(input);
    expect(a.state).toBe(SafetyPolicyState.REVIEW_REQUIRED);
    expect(a.policyVersion).toBe(SAFETY_POLICY_VERSION_PHASE00);
    expect(a.decidedBy).toBe('RULES');
    expect(a.subjectContentVersion).toBe('sha256:1');
  });

  it('its output can never satisfy the publish rule', async () => {
    const a = await port.assess(input);
    expect(canPublishWithSafetyState(a.state)).toBe(false);
    expect(canPublishWithAssessment(a, 'sha256:1').allowed).toBe(false);
  });

  it('rejects malformed input rather than guessing', async () => {
    await expect(port.assess({ ...input, countryCode: 'jordan' })).rejects.toThrow();
  });
});
