import { describe, expect, it } from 'vitest';

import { ApiError } from '../../../common/filters/api-error';
import { onboardingMissing, onboardingNextStep, transitionAccount } from './account';
import {
  constantTimeEquals,
  emailTombstone,
  generateRefreshToken,
  generateVerificationCode,
  hashToken,
  hashVerificationCode,
} from './secrets';

describe('account domain', () => {
  it('drives onboarding from facts in a fixed order', () => {
    const base = {
      emailVerified: true,
      hasUsername: true,
      hasDisplayName: true,
      interestCount: 3,
      minInterests: 3,
    };
    expect(onboardingNextStep(base)).toBe('DONE');
    expect(onboardingNextStep({ ...base, emailVerified: false })).toBe('VERIFY_EMAIL');
    expect(onboardingNextStep({ ...base, hasUsername: false })).toBe('PROFILE');
    expect(onboardingNextStep({ ...base, interestCount: 2 })).toBe('INTERESTS');
    expect(
      onboardingMissing({ ...base, emailVerified: false, hasDisplayName: false, interestCount: 0 }),
    ).toEqual(['EMAIL_VERIFIED', 'DISPLAY_NAME', 'INTERESTS']);
  });

  it('refuses illegal lifecycle transitions with CONFLICT', () => {
    expect(transitionAccount('ACTIVE', 'DEACTIVATE')).toBe('DEACTIVATED');
    expect(() => transitionAccount('DELETED', 'REACTIVATE')).toThrow(ApiError);
    try {
      transitionAccount('SUSPENDED', 'DEACTIVATE');
    } catch (e) {
      expect((e as ApiError).code).toBe('CONFLICT');
    }
  });
});

describe('secrets', () => {
  it('generates high-entropy refresh tokens and stores only hashes', () => {
    const t = generateRefreshToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(generateRefreshToken()).not.toBe(t);
    expect(hashToken(t)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(t)).toBe(hashToken(t));
  });

  it('salts verification codes per account and compares in constant time', () => {
    const code = generateVerificationCode();
    expect(code).toMatch(/^[0-9]{6}$/);
    expect(hashVerificationCode('a', code)).not.toBe(hashVerificationCode('b', code));
    expect(constantTimeEquals('abc', 'abc')).toBe(true);
    expect(constantTimeEquals('abc', 'abd')).toBe(false);
    expect(constantTimeEquals('abc', 'ab')).toBe(false);
    expect(emailTombstone(' Ragad@Example.com ')).toBe(emailTombstone('ragad@example.com'));
  });
});
