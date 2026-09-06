import { z } from 'zod';

import { countryCodeSchema, isoDateTimeSchema, languageTagSchema, uuidSchema } from '../api/common';
import { paginatedSchema } from '../api/pagination';
import { ChallengeInvitesFrom, LocationVisibility, ProfileVisibility } from './age-policy';

/**
 * PUBLIC PROFILE contracts (Profiles context). A profile is a presentation of an account keyed by
 * the immutable accountId; the username is a mutable, unique handle — never an identity key.
 */

// ---------------------------------------------------------------------------------------------
// Username
// ---------------------------------------------------------------------------------------------

export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 30;
/** Lower-case letters, digits and single underscores; must start with a letter; no trailing "_". */
export const USERNAME_PATTERN = /^[a-z](?:[a-z0-9]|_(?=[a-z0-9])){2,29}$/;

/** Handles that must never be claimable by users (impersonation / routing collisions). */
export const RESERVED_USERNAMES: ReadonlySet<string> = new Set([
  'admin',
  'administrator',
  'quest',
  'questapp',
  'quest_official',
  'official',
  'support',
  'help',
  'root',
  'system',
  'api',
  'me',
  'moderator',
  'moderation',
  'staff',
  'team',
  'security',
  'privacy',
  'legal',
  'null',
  'undefined',
  'anonymous',
  'deleted',
  'deleted_user',
]);

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(
    z
      .string()
      .min(USERNAME_MIN_LENGTH)
      .max(USERNAME_MAX_LENGTH)
      .regex(
        USERNAME_PATTERN,
        'Username may contain lowercase letters, digits and single underscores, and must start with a letter',
      )
      .refine((u) => !RESERVED_USERNAMES.has(u), { message: 'Username is reserved' }),
  );
export type Username = z.infer<typeof usernameSchema>;

// ---------------------------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------------------------

export const displayNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(50)
  // Printable text only: no control characters, no zero-width/format characters.
  .regex(/^[^\p{Cc}\p{Cf}]+$/u, 'Display name contains unsupported characters');

export const bioSchema = z
  .string()
  .trim()
  .max(300)
  .regex(/^[^\p{Cc}\p{Cf}]*$/u, 'Bio contains unsupported characters');

/** IANA time zone identifier, e.g. "Asia/Amman". Validated against the runtime's Intl database. */
export const timezoneSchema = z
  .string()
  .min(1)
  .max(64)
  .refine(
    (tz) => {
      try {
        new Intl.DateTimeFormat('en-US', { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    },
    { message: 'Unknown time zone' },
  );

/** Object key pattern for avatars issued by the avatar-upload endpoint. */
export const AVATAR_OBJECT_KEY_PATTERN = /^avatars\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png|webp)$/;
export const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
export const AVATAR_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

export const updateProfileRequestSchema = z.object({
  username: usernameSchema.optional(),
  displayName: displayNameSchema.optional(),
  bio: bioSchema.optional(),
  /** Returned by POST /me/profile/avatar-upload; null clears the avatar. */
  avatarObjectKey: z.string().regex(AVATAR_OBJECT_KEY_PATTERN).nullable().optional(),
  language: languageTagSchema.optional(),
  country: countryCodeSchema.nullable().optional(),
  timezone: timezoneSchema.nullable().optional(),
});
export type UpdateProfileRequest = z.infer<typeof updateProfileRequestSchema>;

/** The owner's view of their own profile. */
export const ownProfileViewSchema = z.object({
  accountId: uuidSchema,
  username: usernameSchema.nullable(),
  displayName: z.string().nullable(),
  bio: z.string(),
  avatarUrl: z.string().url().nullable(),
  avatarObjectKey: z.string().nullable(),
  language: languageTagSchema,
  country: countryCodeSchema.nullable(),
  timezone: z.string().nullable(),
  interests: z.array(z.string()),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type OwnProfileView = z.infer<typeof ownProfileViewSchema>;

/**
 * What other users may see. Deliberately minimal: no email, no DOB, no country below what the
 * owner allows, no timestamps that leak activity. Fields are filtered by visibility server-side.
 */
export const publicProfileViewSchema = z.object({
  accountId: uuidSchema,
  username: usernameSchema,
  displayName: z.string(),
  bio: z.string(),
  avatarUrl: z.string().url().nullable(),
  /** Country shown only when the owner's location visibility is at least CITY. */
  country: countryCodeSchema.nullable(),
  /** True when the requester may see full details; false for a limited card (FOLLOWERS/PRIVATE). */
  isLimited: z.boolean(),
  interests: z.array(z.string()),
});
export type PublicProfileView = z.infer<typeof publicProfileViewSchema>;

export const usernameAvailabilityResponseSchema = z.object({
  username: z.string(),
  available: z.boolean(),
  /** Present when unavailable: RESERVED | TAKEN | INVALID. */
  reason: z.enum(['RESERVED', 'TAKEN', 'INVALID']).nullable(),
});
export type UsernameAvailabilityResponse = z.infer<typeof usernameAvailabilityResponseSchema>;

export const avatarUploadRequestSchema = z.object({
  contentType: z.enum(AVATAR_CONTENT_TYPES),
  sizeBytes: z.number().int().positive().max(AVATAR_MAX_BYTES),
});
export type AvatarUploadRequest = z.infer<typeof avatarUploadRequestSchema>;

export const avatarUploadResponseSchema = z.object({
  objectKey: z.string(),
  uploadUrl: z.string().url(),
  method: z.literal('PUT'),
  headers: z.record(z.string(), z.string()),
  expiresAt: isoDateTimeSchema,
});
export type AvatarUploadResponse = z.infer<typeof avatarUploadResponseSchema>;

// ---------------------------------------------------------------------------------------------
// Interests / onboarding
// ---------------------------------------------------------------------------------------------

export const interestKeySchema = z.string().regex(/^[a-z][a-z0-9-]{1,39}$/);

export const interestSchema = z.object({
  key: interestKeySchema,
  /** English label; localisation arrives with the i18n phase. */
  label: z.string(),
  category: z.string(),
  sortOrder: z.number().int(),
});
export type Interest = z.infer<typeof interestSchema>;
export const interestCatalogueSchema = z.object({ data: z.array(interestSchema) });

export const INTERESTS_MIN_FOR_ONBOARDING = 3;
export const INTERESTS_MAX = 20;

export const updateInterestsRequestSchema = z.object({
  interestKeys: z
    .array(interestKeySchema)
    .max(INTERESTS_MAX)
    .refine((keys) => new Set(keys).size === keys.length, { message: 'Duplicate interests' }),
});
export type UpdateInterestsRequest = z.infer<typeof updateInterestsRequestSchema>;

export const interestsViewSchema = z.object({ interestKeys: z.array(interestKeySchema) });

export const onboardingStatusSchema = z.object({
  completed: z.boolean(),
  nextStep: z.enum(['VERIFY_EMAIL', 'PROFILE', 'INTERESTS', 'DONE']),
  /** What is still missing, so clients can render a checklist. */
  missing: z.array(z.enum(['EMAIL_VERIFIED', 'USERNAME', 'DISPLAY_NAME', 'INTERESTS'])),
});
export type OnboardingStatus = z.infer<typeof onboardingStatusSchema>;

// ---------------------------------------------------------------------------------------------
// Privacy settings
// ---------------------------------------------------------------------------------------------

export const profileVisibilitySchema = z.enum(
  Object.values(ProfileVisibility) as [ProfileVisibility, ...ProfileVisibility[]],
);
export const locationVisibilitySchema = z.enum(
  Object.values(LocationVisibility) as [LocationVisibility, ...LocationVisibility[]],
);
export const challengeInvitesFromSchema = z.enum(
  Object.values(ChallengeInvitesFrom) as [ChallengeInvitesFrom, ...ChallengeInvitesFrom[]],
);

export const privacySettingsSchema = z.object({
  profileVisibility: profileVisibilitySchema,
  locationVisibility: locationVisibilitySchema,
  challengeInvitesFrom: challengeInvitesFromSchema,
  discoverable: z.boolean(),
  /** Fields the user cannot change because of the age policy (informational for the UI). */
  lockedByPolicy: z.array(
    z.enum(['profileVisibility', 'locationVisibility', 'challengeInvitesFrom', 'discoverable']),
  ),
  updatedAt: isoDateTimeSchema,
});
export type PrivacySettings = z.infer<typeof privacySettingsSchema>;

export const updatePrivacySettingsRequestSchema = z.object({
  profileVisibility: profileVisibilitySchema.optional(),
  locationVisibility: locationVisibilitySchema.optional(),
  challengeInvitesFrom: challengeInvitesFromSchema.optional(),
  discoverable: z.boolean().optional(),
});
export type UpdatePrivacySettingsRequest = z.infer<typeof updatePrivacySettingsRequestSchema>;

// ---------------------------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------------------------

export const blockUserRequestSchema = z.object({ accountId: uuidSchema });
export type BlockUserRequest = z.infer<typeof blockUserRequestSchema>;

export const blockViewSchema = z.object({
  accountId: uuidSchema,
  /** Snapshot of the handle at block time so the list stays readable if the user renames. */
  username: z.string().nullable(),
  blockedAt: isoDateTimeSchema,
});
export type BlockView = z.infer<typeof blockViewSchema>;
export const blockListSchema = paginatedSchema(blockViewSchema);
