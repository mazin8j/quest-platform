import { type IdentityProvider, emailSchema } from '@quest/types';
import { type JWTVerifyGetKey, createRemoteJWKSet, jwtVerify } from 'jose';

import type {
  IdentityProviderPort,
  IdentityProviderRegistry,
  VerifiedExternalIdentity,
} from '../ports/identity-provider.port';

/**
 * Local/dev/test adapter. Token format: `fake:<subject>:<email>[:unverified]`.
 * Enabled only by AUTH_FAKE_PROVIDER_ENABLED=true, which production configuration refuses.
 */
export class FakeIdentityProvider implements IdentityProviderPort {
  readonly provider = 'FAKE' as const;

  verifyIdToken(idToken: string): Promise<VerifiedExternalIdentity | null> {
    const parts = idToken.split(':');
    if (parts[0] !== 'fake' || parts.length < 3) return Promise.resolve(null);
    const subject = parts[1] ?? '';
    const email = emailSchema.safeParse(parts[2]);
    if (!/^[A-Za-z0-9._-]{3,128}$/.test(subject) || !email.success) return Promise.resolve(null);
    return Promise.resolve({
      provider: 'FAKE',
      subject,
      email: email.data,
      emailVerified: parts[3] !== 'unverified',
    });
  }
}

interface OidcProviderOptions {
  provider: Exclude<IdentityProvider, 'FAKE'>;
  jwksUrl: string;
  issuer: string | string[];
  audience: string;
}

/**
 * OpenID Connect id_token verification for Apple and Google against their published JWKS.
 * No client secret is needed for token verification; the client id (audience) is configuration.
 */
export class OidcIdentityProvider implements IdentityProviderPort {
  readonly provider: IdentityProvider;
  private readonly jwks: JWTVerifyGetKey;

  constructor(private readonly options: OidcProviderOptions) {
    this.provider = options.provider;
    this.jwks = createRemoteJWKSet(new URL(options.jwksUrl));
  }

  async verifyIdToken(idToken: string): Promise<VerifiedExternalIdentity | null> {
    try {
      const { payload } = await jwtVerify(idToken, this.jwks, {
        issuer: this.options.issuer,
        audience: this.options.audience,
        algorithms: ['RS256', 'ES256'],
      });
      if (typeof payload.sub !== 'string' || payload.sub.length === 0) return null;
      const rawEmail = typeof payload.email === 'string' ? payload.email : null;
      const parsed = rawEmail ? emailSchema.safeParse(rawEmail) : null;
      // Apple omits `email_verified` for addresses it has verified itself; an explicit false from
      // any provider is honoured. Google always sends the claim.
      const verifiedClaim = payload.email_verified;
      const emailVerified =
        verifiedClaim === true ||
        verifiedClaim === 'true' ||
        (this.provider === 'APPLE' && verifiedClaim === undefined && !!parsed?.success);
      return {
        provider: this.provider,
        subject: payload.sub,
        email: parsed?.success ? parsed.data : null,
        emailVerified: !!parsed?.success && emailVerified,
      };
    } catch {
      return null;
    }
  }
}

export const APPLE_OIDC = {
  jwksUrl: 'https://appleid.apple.com/auth/keys',
  issuer: 'https://appleid.apple.com',
} as const;
export const GOOGLE_OIDC = {
  jwksUrl: 'https://www.googleapis.com/oauth2/v3/certs',
  issuer: ['https://accounts.google.com', 'accounts.google.com'],
} as const;

export class StaticIdentityProviderRegistry implements IdentityProviderRegistry {
  private readonly map = new Map<IdentityProvider, IdentityProviderPort>();

  constructor(providers: ReadonlyArray<IdentityProviderPort>) {
    for (const p of providers) this.map.set(p.provider, p);
  }

  get(provider: IdentityProvider): IdentityProviderPort | undefined {
    return this.map.get(provider);
  }

  enabled(): IdentityProvider[] {
    return [...this.map.keys()];
  }
}
