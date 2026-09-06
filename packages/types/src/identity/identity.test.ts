import { describe, expect, it } from 'vitest';

import {
  ACCOUNT_TRANSITIONS,
  AccountState,
  AccountTransition,
  AgeBand,
  Permission,
  Role,
  SIGN_IN_ALLOWED_STATES,
  STAFF_ROLES,
  canTransitionAccount,
  changePasswordRequestSchema,
  dateOfBirthSchema,
  deriveAgeBand,
  hasPermission,
  isMinorBand,
  isStaff,
  nextAccountState,
  passwordContainsEmailLocalPart,
  passwordSchema,
  permissionsForRoles,
  privacyDefaultsFor,
  privacyPolicyViolations,
  registerRequestSchema,
  rolePermissions,
  timezoneSchema,
  updateInterestsRequestSchema,
  usernameSchema,
} from './index';

const iso = (d: Date) => d.toISOString().slice(0, 10);
const yearsAgo = (years: number, extraDays = 0) => {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - years);
  d.setUTCDate(d.getUTCDate() + extraDays);
  return iso(d);
};

describe('account lifecycle state machine', () => {
  it('allows only the documented transitions', () => {
    expect(nextAccountState('PENDING_VERIFICATION', 'VERIFY_EMAIL')).toBe('ACTIVE');
    expect(nextAccountState('ACTIVE', 'DEACTIVATE')).toBe('DEACTIVATED');
    expect(nextAccountState('DEACTIVATED', 'REACTIVATE')).toBe('ACTIVE');
    expect(nextAccountState('ACTIVE', 'SUSPEND')).toBe('SUSPENDED');
    expect(nextAccountState('SUSPENDED', 'REINSTATE')).toBe('ACTIVE');
    expect(nextAccountState('ACTIVE', 'REQUEST_DELETION')).toBe('DELETION_REQUESTED');
    expect(nextAccountState('DELETION_REQUESTED', 'CANCEL_DELETION')).toBe('ACTIVE');
    expect(nextAccountState('DELETION_REQUESTED', 'COMPLETE_DELETION')).toBe('DELETED');
  });

  it('forbids leaving DELETED and every undeclared transition', () => {
    for (const t of Object.values(AccountTransition)) {
      expect(canTransitionAccount('DELETED', t)).toBe(false);
    }
    expect(canTransitionAccount('ACTIVE', 'VERIFY_EMAIL')).toBe(false);
    expect(canTransitionAccount('SUSPENDED', 'DEACTIVATE')).toBe(false);
    expect(canTransitionAccount('SUSPENDED', 'REACTIVATE')).toBe(false);
    expect(canTransitionAccount('PENDING_VERIFICATION', 'DEACTIVATE')).toBe(false);
  });

  it('never lets a suspended account sign in, and covers every state in the table', () => {
    expect(SIGN_IN_ALLOWED_STATES.has('SUSPENDED')).toBe(false);
    expect(SIGN_IN_ALLOWED_STATES.has('DELETED')).toBe(false);
    expect(Object.keys(ACCOUNT_TRANSITIONS).sort()).toEqual(Object.values(AccountState).sort());
  });
});

describe('age policy foundation', () => {
  it('derives bands from a date of birth and refuses under-age users', () => {
    expect(deriveAgeBand(yearsAgo(12, -1))).toBe(AgeBand.UNDER_MINIMUM);
    expect(deriveAgeBand(yearsAgo(13))).toBe(AgeBand.TEEN_13_15);
    expect(deriveAgeBand(yearsAgo(15, -1))).toBe(AgeBand.TEEN_13_15);
    expect(deriveAgeBand(yearsAgo(16))).toBe(AgeBand.TEEN_16_17);
    expect(deriveAgeBand(yearsAgo(18))).toBe(AgeBand.ADULT);
    expect(deriveAgeBand(yearsAgo(40))).toBe(AgeBand.ADULT);
    expect(isMinorBand(AgeBand.TEEN_16_17)).toBe(true);
    expect(isMinorBand(AgeBand.ADULT)).toBe(false);
  });

  it('counts birthdays exactly (the day before the 18th birthday is still a minor)', () => {
    const at = new Date(Date.UTC(2026, 8, 6));
    expect(deriveAgeBand('2008-09-07', at)).toBe(AgeBand.TEEN_16_17);
    expect(deriveAgeBand('2008-09-06', at)).toBe(AgeBand.ADULT);
  });

  it('validates the date of birth input strictly', () => {
    expect(dateOfBirthSchema.safeParse('2024-02-30').success).toBe(false);
    expect(dateOfBirthSchema.safeParse('not-a-date').success).toBe(false);
    expect(dateOfBirthSchema.safeParse(yearsAgo(0, 1)).success).toBe(false);
    expect(dateOfBirthSchema.safeParse(yearsAgo(130)).success).toBe(false);
    expect(dateOfBirthSchema.safeParse(yearsAgo(25)).success).toBe(true);
  });

  it('locks younger teens to private, hidden-location, non-discoverable settings', () => {
    expect(privacyDefaultsFor('TEEN_13_15')).toEqual({
      profileVisibility: 'PRIVATE',
      locationVisibility: 'HIDDEN',
      challengeInvitesFrom: 'FOLLOWERS',
      discoverable: false,
    });
    expect(
      privacyPolicyViolations('TEEN_13_15', {
        profileVisibility: 'PUBLIC',
        locationVisibility: 'CITY',
        discoverable: true,
        challengeInvitesFrom: 'NOBODY',
      }),
    ).toEqual(['profileVisibility', 'locationVisibility', 'discoverable']);
    expect(privacyPolicyViolations('TEEN_16_17', { locationVisibility: 'NEIGHBOURHOOD' })).toEqual([
      'locationVisibility',
    ]);
    expect(privacyPolicyViolations('TEEN_16_17', { profileVisibility: 'PUBLIC' })).toEqual([]);
    expect(privacyPolicyViolations('ADULT', { locationVisibility: 'NEIGHBOURHOOD' })).toEqual([]);
  });

  it('never offers precise location as a visibility option', () => {
    for (const band of Object.values(AgeBand)) {
      expect(privacyPolicyViolations(band, { locationVisibility: 'PRECISE' as never })).toContain(
        'locationVisibility',
      );
    }
  });
});

describe('roles and permissions', () => {
  it('gives every account only self-service permissions by default', () => {
    expect(hasPermission(['USER'], Permission.MANAGE_OWN_PROFILE)).toBe(true);
    expect(hasPermission(['USER'], Permission.VIEW_USER_SUPPORT_PROFILE)).toBe(false);
    expect(hasPermission(['USER'], Permission.MANAGE_STAFF)).toBe(false);
  });

  it('restricts MANAGE_STAFF to SUPER_ADMIN and keeps SUPPORT read-only on users', () => {
    for (const role of STAFF_ROLES) {
      expect(rolePermissions[role].has(Permission.MANAGE_STAFF)).toBe(role === Role.SUPER_ADMIN);
    }
    expect(rolePermissions.SUPPORT.has(Permission.SANCTION_USER)).toBe(false);
    expect(rolePermissions.READ_ONLY.size).toBe(1);
  });

  it('unions permissions across roles and identifies staff', () => {
    const perms = permissionsForRoles(['USER', 'SUPPORT']);
    expect(perms.has(Permission.MANAGE_OWN_ACCOUNT)).toBe(true);
    expect(perms.has(Permission.VIEW_USER_SUPPORT_PROFILE)).toBe(true);
    expect(isStaff(['USER'])).toBe(false);
    expect(isStaff(['USER', 'ANALYST'])).toBe(true);
    // Staff roles never implicitly carry self-service rights (staff accounts are still USER).
    expect(rolePermissions.SUPER_ADMIN.has(Permission.MANAGE_OWN_PROFILE)).toBe(false);
  });
});

describe('authentication contracts', () => {
  it('enforces the password policy without leaking it at sign-in', () => {
    expect(passwordSchema.safeParse('short').success).toBe(false);
    expect(passwordSchema.safeParse('Password123').success).toBe(false);
    expect(passwordSchema.safeParse('aaaaaaaaaaaa').success).toBe(false);
    expect(passwordSchema.safeParse('          ').success).toBe(false);
    expect(passwordSchema.safeParse('correct horse battery').success).toBe(true);
    expect(passwordContainsEmailLocalPart('ragad-dahdolan-2026', 'Ragad.Dahdolan@x.io')).toBe(
      false,
    );
    expect(passwordContainsEmailLocalPart('xxragaddahdolanxx', 'ragaddahdolan@x.io')).toBe(true);
  });

  it('validates registration end to end (email normalisation, consents, DOB)', () => {
    const valid = registerRequestSchema.safeParse({
      email: '  Ragad@Example.COM ',
      password: 'a sufficiently long secret',
      dateOfBirth: yearsAgo(30),
      consents: {
        termsOfServiceVersion: '2026-09',
        privacyPolicyVersion: '2026-09',
        ageAttestation: true,
      },
    });
    expect(valid.success).toBe(true);
    if (valid.success) {
      expect(valid.data.email).toBe('ragad@example.com');
      expect(valid.data.consents.analytics).toBe(false);
      expect(valid.data.consents.marketing).toBe(false);
    }
    const noAttestation = registerRequestSchema.safeParse({
      email: 'a@b.co',
      password: 'a sufficiently long secret',
      dateOfBirth: yearsAgo(30),
      consents: { termsOfServiceVersion: '2026-09', privacyPolicyVersion: '2026-09' },
    });
    expect(noAttestation.success).toBe(false);
    const emailInPassword = registerRequestSchema.safeParse({
      email: 'ragaddahdolan@b.co',
      password: 'ragaddahdolan-secret',
      dateOfBirth: yearsAgo(30),
      consents: {
        termsOfServiceVersion: '2026-09',
        privacyPolicyVersion: '2026-09',
        ageAttestation: true,
      },
    });
    expect(emailInPassword.success).toBe(false);
  });

  it('requires a different new password on change', () => {
    expect(
      changePasswordRequestSchema.safeParse({
        currentPassword: 'same same same same',
        newPassword: 'same same same same',
      }).success,
    ).toBe(false);
  });
});

describe('profile contracts', () => {
  it('normalises and validates usernames, rejecting reserved handles', () => {
    expect(usernameSchema.parse('  Ragad_D ')).toBe('ragad_d');
    expect(usernameSchema.safeParse('ab').success).toBe(false);
    expect(usernameSchema.safeParse('1abc').success).toBe(false);
    expect(usernameSchema.safeParse('a__b').success).toBe(false);
    expect(usernameSchema.safeParse('abc_').success).toBe(false);
    expect(usernameSchema.safeParse('Admin').success).toBe(false);
    expect(usernameSchema.safeParse('quest_official').success).toBe(false);
    expect(usernameSchema.safeParse('x'.repeat(31)).success).toBe(false);
  });

  it('validates time zones through the Intl database', () => {
    expect(timezoneSchema.safeParse('Asia/Amman').success).toBe(true);
    expect(timezoneSchema.safeParse('Mars/Olympus').success).toBe(false);
  });

  it('rejects duplicate interests and oversized selections', () => {
    expect(updateInterestsRequestSchema.safeParse({ interestKeys: ['a1', 'a1'] }).success).toBe(
      false,
    );
    expect(
      updateInterestsRequestSchema.safeParse({
        interestKeys: Array.from({ length: 21 }, (_, i) => `k${i}`),
      }).success,
    ).toBe(false);
  });
});
