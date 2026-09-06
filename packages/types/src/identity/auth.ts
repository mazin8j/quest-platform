import { z } from 'zod';

import { countryCodeSchema, isoDateTimeSchema, languageTagSchema, uuidSchema } from '../api/common';
import { dateOfBirthSchema } from './age-policy';
import { roleSchema } from './authz';
import { accountStateSchema } from './lifecycle';

/**
 * AUTHENTICATION contracts (Phase 01). Authentication is strictly separated from the ACCOUNT
 * (lifecycle, roles, contact email) and from the PUBLIC PROFILE (profiles.ts). Identity keys are
 * immutable internal UUIDs; email and username are mutable attributes, never identity keys.
 */

// ---------------------------------------------------------------------------------------------
// Email
// ---------------------------------------------------------------------------------------------

/** Lower-cased, trimmed, RFC-5322-ish; bounded so it can be indexed and never used as a key. */
export const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));

// ---------------------------------------------------------------------------------------------
// Password policy
// ---------------------------------------------------------------------------------------------

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

/**
 * Small deny-list of the most common passwords (case-insensitive). A breached-password check
 * (k-anonymity range query) sits behind a port in the API and is a documented follow-up.
 */
export const COMMON_PASSWORDS: ReadonlySet<string> = new Set([
  'password',
  'password1',
  'password12',
  'password123',
  'passw0rd',
  'p@ssw0rd',
  'p@ssword1',
  '1234567890',
  '12345678910',
  '0123456789',
  'qwertyuiop',
  'qwerty1234',
  'qwerty12345',
  'iloveyou12',
  'iloveyou123',
  'letmein123',
  'welcome123',
  'admin12345',
  'administrator',
  'abcdefghij',
  'abc1234567',
  'football123',
  'baseball123',
  'sunshine123',
  'princess123',
  'superman123',
  'trustno1234',
  'changeme123',
  'quest12345',
  'questquest',
]);

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters`)
  .max(PASSWORD_MAX_LENGTH, `Password must be at most ${PASSWORD_MAX_LENGTH} characters`)
  .refine((p) => p.trim().length >= PASSWORD_MIN_LENGTH, {
    message: 'Password must not be mostly whitespace',
  })
  .refine((p) => !COMMON_PASSWORDS.has(p.toLowerCase()), {
    message: 'Password is too common',
  })
  .refine((p) => !/^(.)\1+$/.test(p), {
    message: 'Password must not be a single repeated character',
  });

/** Extra rule that needs the email: the password must not contain the email's local part. */
export function passwordContainsEmailLocalPart(password: string, email: string): boolean {
  const local = email.split('@')[0]?.toLowerCase() ?? '';
  return local.length >= 4 && password.toLowerCase().includes(local);
}

// ---------------------------------------------------------------------------------------------
// Consent (required at registration; full history lives in account.ts)
// ---------------------------------------------------------------------------------------------

export const ConsentType = {
  TERMS_OF_SERVICE: 'TERMS_OF_SERVICE',
  PRIVACY_POLICY: 'PRIVACY_POLICY',
  AGE_ATTESTATION: 'AGE_ATTESTATION',
  ANALYTICS: 'ANALYTICS',
  PERSONALISATION: 'PERSONALISATION',
  MARKETING: 'MARKETING',
} as const;
export type ConsentType = (typeof ConsentType)[keyof typeof ConsentType];
export const consentTypeSchema = z.enum(
  Object.values(ConsentType) as [ConsentType, ...ConsentType[]],
);

/** Document version identifiers, e.g. "2026-09". Bumping a version re-prompts users. */
export const consentDocumentVersionSchema = z.string().regex(/^[0-9]{4}-[0-9]{2}(\.[0-9]+)?$/);

/** Consents a user gives at registration. Terms + privacy + age attestation are mandatory. */
export const registrationConsentsSchema = z.object({
  termsOfServiceVersion: consentDocumentVersionSchema,
  privacyPolicyVersion: consentDocumentVersionSchema,
  /** The user attests the date of birth is truthful; required by the age policy. */
  ageAttestation: z.literal(true),
  /** Optional consents default to false — never pre-ticked. */
  analytics: z.boolean().default(false),
  personalisation: z.boolean().default(false),
  marketing: z.boolean().default(false),
});
export type RegistrationConsents = z.infer<typeof registrationConsentsSchema>;
export type RegistrationConsentsInput = z.input<typeof registrationConsentsSchema>;

// ---------------------------------------------------------------------------------------------
// Devices / clients (declared by the client at sign-in; optional)
// ---------------------------------------------------------------------------------------------

export const ClientPlatform = { IOS: 'IOS', ANDROID: 'ANDROID', WEB: 'WEB' } as const;
export type ClientPlatform = (typeof ClientPlatform)[keyof typeof ClientPlatform];
export const clientPlatformSchema = z.enum(
  Object.values(ClientPlatform) as [ClientPlatform, ...ClientPlatform[]],
);

/** Client-generated, stable per installation (secure storage). Never a hardware identifier. */
export const installationIdSchema = z.string().regex(/^[A-Za-z0-9._-]{8,128}$/);

export const clientContextSchema = z.object({
  platform: clientPlatformSchema,
  installationId: installationIdSchema,
  appVersion: z.string().max(32).optional(),
  /** Free-text device name shown in the sessions list ("Ragad's iPhone"). Sanitised, bounded. */
  deviceName: z.string().trim().max(64).optional(),
});
export type ClientContext = z.infer<typeof clientContextSchema>;

// ---------------------------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------------------------

export const tokenPairSchema = z.object({
  /** Short-lived JWT (Bearer). */
  accessToken: z.string().min(1),
  /** Seconds until the access token expires. */
  accessTokenExpiresIn: z.number().int().positive(),
  /** Opaque, single-use, rotated on every refresh. Store only in secure storage. */
  refreshToken: z.string().min(1),
  refreshTokenExpiresAt: isoDateTimeSchema,
  sessionId: uuidSchema,
  tokenType: z.literal('Bearer'),
});
export type TokenPair = z.infer<typeof tokenPairSchema>;

// ---------------------------------------------------------------------------------------------
// Account view returned by auth endpoints and GET /v1/me
// ---------------------------------------------------------------------------------------------

export const OnboardingStep = {
  VERIFY_EMAIL: 'VERIFY_EMAIL',
  PROFILE: 'PROFILE',
  INTERESTS: 'INTERESTS',
  DONE: 'DONE',
} as const;
export type OnboardingStep = (typeof OnboardingStep)[keyof typeof OnboardingStep];
export const onboardingStepSchema = z.enum(
  Object.values(OnboardingStep) as [OnboardingStep, ...OnboardingStep[]],
);

export const accountViewSchema = z.object({
  /** Immutable internal identity key. */
  accountId: uuidSchema,
  email: emailSchema,
  emailVerified: z.boolean(),
  state: accountStateSchema,
  /** Derived from the stored date of birth; the date itself is never returned to clients. */
  ageBand: z.enum(['TEEN_13_15', 'TEEN_16_17', 'ADULT']),
  roles: z.array(roleSchema),
  onboarding: z.object({
    completed: z.boolean(),
    nextStep: onboardingStepSchema,
  }),
  createdAt: isoDateTimeSchema,
  /** Present while a deletion request is pending. */
  deletionScheduledFor: isoDateTimeSchema.nullable(),
});
export type AccountView = z.infer<typeof accountViewSchema>;

export const authResponseSchema = z.object({
  account: accountViewSchema,
  tokens: tokenPairSchema,
});
export type AuthResponse = z.infer<typeof authResponseSchema>;

// ---------------------------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------------------------

export const registerRequestSchema = z
  .object({
    email: emailSchema,
    password: passwordSchema,
    dateOfBirth: dateOfBirthSchema,
    consents: registrationConsentsSchema,
    /** Preferred UI language; defaults to the device locale on mobile. */
    language: languageTagSchema.optional(),
    country: countryCodeSchema.optional(),
    client: clientContextSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (passwordContainsEmailLocalPart(value.password, value.email)) {
      ctx.addIssue({
        code: 'custom',
        path: ['password'],
        message: 'Password must not contain your email address',
      });
    }
  });
export type RegisterRequest = z.infer<typeof registerRequestSchema>;
export type RegisterRequestInput = z.input<typeof registerRequestSchema>;

export const loginRequestSchema = z.object({
  email: emailSchema,
  /** Not the password schema: never reveal policy details on a failed sign-in. */
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
  client: clientContextSchema.optional(),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const IdentityProvider = {
  APPLE: 'APPLE',
  GOOGLE: 'GOOGLE',
  /** Local/dev/test adapter; refused in production by configuration. */
  FAKE: 'FAKE',
} as const;
export type IdentityProvider = (typeof IdentityProvider)[keyof typeof IdentityProvider];
export const identityProviderSchema = z.enum(
  Object.values(IdentityProvider) as [IdentityProvider, ...IdentityProvider[]],
);

export const providerSignInRequestSchema = z.object({
  provider: identityProviderSchema,
  /** The provider's identity token (Apple/Google id_token). Verified server-side. */
  idToken: z.string().min(1).max(8192),
  client: clientContextSchema.optional(),
});
export type ProviderSignInRequest = z.infer<typeof providerSignInRequestSchema>;

export const providerRegisterRequestSchema = providerSignInRequestSchema.extend({
  dateOfBirth: dateOfBirthSchema,
  consents: registrationConsentsSchema,
  language: languageTagSchema.optional(),
  country: countryCodeSchema.optional(),
});
export type ProviderRegisterRequest = z.infer<typeof providerRegisterRequestSchema>;

export const refreshRequestSchema = z.object({
  refreshToken: z.string().min(1).max(512),
});
export type RefreshRequest = z.infer<typeof refreshRequestSchema>;

/** 6-digit numeric code delivered by email. */
export const verificationCodeSchema = z.string().regex(/^[0-9]{6}$/);

export const verifyEmailRequestSchema = z.object({ code: verificationCodeSchema });
export type VerifyEmailRequest = z.infer<typeof verifyEmailRequestSchema>;

export const changePasswordRequestSchema = z
  .object({
    currentPassword: z.string().min(1).max(PASSWORD_MAX_LENGTH),
    newPassword: passwordSchema,
  })
  .refine((v) => v.currentPassword !== v.newPassword, {
    path: ['newPassword'],
    message: 'New password must differ from the current password',
  });
export type ChangePasswordRequest = z.infer<typeof changePasswordRequestSchema>;

export const forgotPasswordRequestSchema = z.object({ email: emailSchema });
export type ForgotPasswordRequest = z.infer<typeof forgotPasswordRequestSchema>;

export const resetPasswordRequestSchema = z.object({
  email: emailSchema,
  code: verificationCodeSchema,
  newPassword: passwordSchema,
});
export type ResetPasswordRequest = z.infer<typeof resetPasswordRequestSchema>;

/** Generic acknowledgement for endpoints that must not reveal state (forgot password, resend). */
export const acceptedResponseSchema = z.object({ accepted: z.literal(true) });
export type AcceptedResponse = z.infer<typeof acceptedResponseSchema>;
