import type { IdentityProvider } from '@quest/types';

/** What a verified external identity token proves. */
export interface VerifiedExternalIdentity {
  provider: IdentityProvider;
  /** Provider-stable subject (Apple `sub`, Google `sub`). */
  subject: string;
  /** Email asserted by the provider, if any and if verified by the provider. */
  email: string | null;
  emailVerified: boolean;
}

export interface IdentityProviderPort {
  readonly provider: IdentityProvider;
  /** Verifies signature, issuer, audience and expiry. Returns null for any invalid token. */
  verifyIdToken(idToken: string): Promise<VerifiedExternalIdentity | null>;
}

/** Registry of enabled providers (adapters are enabled by configuration). */
export interface IdentityProviderRegistry {
  get(provider: IdentityProvider): IdentityProviderPort | undefined;
  enabled(): IdentityProvider[];
}
export const IDENTITY_PROVIDERS = Symbol('IDENTITY_PROVIDERS');
