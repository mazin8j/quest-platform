import { dateOfBirthSchema, emailSchema, passwordSchema } from '@quest/types';

/**
 * Document versions the client presents. They must match the API's AUTH_TERMS_VERSION /
 * AUTH_PRIVACY_POLICY_VERSION; a mismatch is rejected server-side and surfaces as a form error,
 * which is the signal to ship an app update with the new documents.
 */
export const CURRENT_TERMS_VERSION = '2026-09';
export const CURRENT_PRIVACY_VERSION = '2026-09';

export interface SignUpFormInput {
  email: string;
  password: string;
  dateOfBirth: string;
  accepted: boolean;
}

/** Client-side pre-validation with the shared contracts (the API re-validates everything). */
export function validateSignUp(input: SignUpFormInput): {
  ok: boolean;
  errors: Record<string, string>;
} {
  const errors: Record<string, string> = {};
  if (!emailSchema.safeParse(input.email).success) errors.email = 'Enter a valid email address';
  const password = passwordSchema.safeParse(input.password);
  if (!password.success) errors.password = password.error.issues[0]?.message ?? 'Invalid password';
  if (!dateOfBirthSchema.safeParse(input.dateOfBirth).success)
    errors.dateOfBirth = 'Enter your date of birth as YYYY-MM-DD';
  if (!input.accepted) errors.accepted = 'You must accept the terms and privacy policy';
  return { ok: Object.keys(errors).length === 0, errors };
}
