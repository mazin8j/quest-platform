import { z } from 'zod';

/**
 * Age / minor policy foundation (Phase 01). QUEST collects a date of birth once at onboarding
 * (CONFIDENTIAL; never exposed to other users, never in events or analytics) and derives an age
 * band from it at read time. Every elevated control for minors keys off the band, never the DOB.
 *
 * Bands are deliberately coarse and future-proof: later phases (content restrictions via
 * `RESTRICTED.minimumAge`, parental controls, regional age-of-consent rules) refine policy
 * without touching stored data.
 */
export const AgeBand = {
  /** Below the platform minimum age — registration is refused; never persisted. */
  UNDER_MINIMUM: 'UNDER_MINIMUM',
  TEEN_13_15: 'TEEN_13_15',
  TEEN_16_17: 'TEEN_16_17',
  ADULT: 'ADULT',
} as const;
export type AgeBand = (typeof AgeBand)[keyof typeof AgeBand];
export const ageBandSchema = z.enum(Object.values(AgeBand) as [AgeBand, ...AgeBand[]]);

/** Platform-wide minimum age. Regional overrides (e.g. digital age of consent) are a later phase. */
export const MINIMUM_AGE = 13;
export const ADULT_AGE = 18;
/** Sanity bound for date-of-birth input. */
export const MAX_AGE = 120;

/** ISO calendar date (YYYY-MM-DD) in the past, at most MAX_AGE years ago. */
export const dateOfBirthSchema = z.iso.date().refine(
  (value) => {
    const dob = parseIsoDate(value);
    if (!dob) return false;
    const now = new Date();
    if (dob.getTime() > now.getTime()) return false;
    return ageInYears(dob, now) <= MAX_AGE;
  },
  { message: 'Date of birth must be a valid past date' },
);
export type DateOfBirth = z.infer<typeof dateOfBirthSchema>;

function parseIsoDate(value: string): Date | undefined {
  const [y, m, d] = value.split('-').map(Number);
  if (!y || !m || !d) return undefined;
  const date = new Date(Date.UTC(y, m - 1, d));
  // Reject overflowed dates such as 2024-02-30.
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    return undefined;
  }
  return date;
}

/** Whole years between `dob` and `at` (UTC calendar arithmetic; birthday counts from 00:00 UTC). */
export function ageInYears(dob: Date, at: Date = new Date()): number {
  let age = at.getUTCFullYear() - dob.getUTCFullYear();
  const beforeBirthday =
    at.getUTCMonth() < dob.getUTCMonth() ||
    (at.getUTCMonth() === dob.getUTCMonth() && at.getUTCDate() < dob.getUTCDate());
  if (beforeBirthday) age -= 1;
  return age;
}

export function deriveAgeBand(dateOfBirth: string, at: Date = new Date()): AgeBand {
  const dob = parseIsoDate(dateOfBirth);
  if (!dob) return AgeBand.UNDER_MINIMUM;
  const age = ageInYears(dob, at);
  if (age < MINIMUM_AGE) return AgeBand.UNDER_MINIMUM;
  if (age < 16) return AgeBand.TEEN_13_15;
  if (age < ADULT_AGE) return AgeBand.TEEN_16_17;
  return AgeBand.ADULT;
}

export function isMinorBand(band: AgeBand): boolean {
  return band !== AgeBand.ADULT;
}

export const ProfileVisibility = {
  PUBLIC: 'PUBLIC',
  FOLLOWERS: 'FOLLOWERS',
  PRIVATE: 'PRIVATE',
} as const;
export type ProfileVisibility = (typeof ProfileVisibility)[keyof typeof ProfileVisibility];

/** How coarse the user's location may appear to others. Precise is never an option (PRIVACY §5). */
export const LocationVisibility = {
  HIDDEN: 'HIDDEN',
  CITY: 'CITY',
  NEIGHBOURHOOD: 'NEIGHBOURHOOD',
} as const;
export type LocationVisibility = (typeof LocationVisibility)[keyof typeof LocationVisibility];

export const ChallengeInvitesFrom = {
  EVERYONE: 'EVERYONE',
  FOLLOWERS: 'FOLLOWERS',
  NOBODY: 'NOBODY',
} as const;
export type ChallengeInvitesFrom = (typeof ChallengeInvitesFrom)[keyof typeof ChallengeInvitesFrom];

export interface PrivacyControls {
  profileVisibility: ProfileVisibility;
  locationVisibility: LocationVisibility;
  challengeInvitesFrom: ChallengeInvitesFrom;
  /** Whether the profile can be found by username search / suggestions. */
  discoverable: boolean;
}

/**
 * Elevated defaults and hard limits per age band (PRIVACY_PRINCIPLES.md §8). `defaults` seed the
 * privacy settings row at registration; `allowed` lists the values a user in that band may
 * choose. The API rejects anything outside `allowed` with FORBIDDEN and names the field.
 */
export interface AgeBandPrivacyPolicy {
  readonly defaults: Readonly<PrivacyControls>;
  readonly allowed: {
    readonly [K in keyof PrivacyControls]: ReadonlyArray<PrivacyControls[K]>;
  };
}

const ALL: AgeBandPrivacyPolicy['allowed'] = {
  profileVisibility: ['PUBLIC', 'FOLLOWERS', 'PRIVATE'],
  locationVisibility: ['HIDDEN', 'CITY', 'NEIGHBOURHOOD'],
  challengeInvitesFrom: ['EVERYONE', 'FOLLOWERS', 'NOBODY'],
  discoverable: [true, false],
};

export const AGE_BAND_PRIVACY_POLICY: Readonly<Record<AgeBand, AgeBandPrivacyPolicy>> = {
  UNDER_MINIMUM: {
    defaults: {
      profileVisibility: 'PRIVATE',
      locationVisibility: 'HIDDEN',
      challengeInvitesFrom: 'NOBODY',
      discoverable: false,
    },
    allowed: {
      profileVisibility: ['PRIVATE'],
      locationVisibility: ['HIDDEN'],
      challengeInvitesFrom: ['NOBODY'],
      discoverable: [false],
    },
  },
  TEEN_13_15: {
    defaults: {
      profileVisibility: 'PRIVATE',
      locationVisibility: 'HIDDEN',
      challengeInvitesFrom: 'FOLLOWERS',
      discoverable: false,
    },
    // Younger teens: never public, never locatable, never discoverable by strangers.
    allowed: {
      profileVisibility: ['FOLLOWERS', 'PRIVATE'],
      locationVisibility: ['HIDDEN'],
      challengeInvitesFrom: ['FOLLOWERS', 'NOBODY'],
      discoverable: [false],
    },
  },
  TEEN_16_17: {
    defaults: {
      profileVisibility: 'PRIVATE',
      locationVisibility: 'HIDDEN',
      challengeInvitesFrom: 'FOLLOWERS',
      discoverable: false,
    },
    // Older teens may open their profile but never reveal location below city level.
    allowed: {
      profileVisibility: ['PUBLIC', 'FOLLOWERS', 'PRIVATE'],
      locationVisibility: ['HIDDEN', 'CITY'],
      challengeInvitesFrom: ['EVERYONE', 'FOLLOWERS', 'NOBODY'],
      discoverable: [true, false],
    },
  },
  ADULT: {
    defaults: {
      profileVisibility: 'PUBLIC',
      locationVisibility: 'CITY',
      challengeInvitesFrom: 'EVERYONE',
      discoverable: true,
    },
    allowed: ALL,
  },
};

/** Fields of `controls` whose value is not permitted for `band`. Empty array = compliant. */
export function privacyPolicyViolations(
  band: AgeBand,
  controls: Partial<PrivacyControls>,
): Array<keyof PrivacyControls> {
  const policy = AGE_BAND_PRIVACY_POLICY[band];
  const violations: Array<keyof PrivacyControls> = [];
  for (const key of Object.keys(policy.allowed) as Array<keyof PrivacyControls>) {
    const value = controls[key];
    if (value === undefined) continue;
    const allowed = policy.allowed[key] as ReadonlyArray<unknown>;
    if (!allowed.includes(value)) violations.push(key);
  }
  return violations;
}

/** Defaults applied when an account's band changes (birthday) or at registration. */
export function privacyDefaultsFor(band: AgeBand): PrivacyControls {
  return { ...AGE_BAND_PRIVACY_POLICY[band].defaults };
}
