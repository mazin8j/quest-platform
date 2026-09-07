import type { Role } from '@quest/types';

/** Claims carried by an access token. Never email, names or DOB. */
export interface AccessTokenClaims {
  /** Account id. */
  sub: string;
  /** Session id — lets revocation take effect before expiry. */
  sid: string;
  roles: Role[];
  /** Token id (unique per issued token). */
  jti: string;
}

export interface TokenSignerPort {
  sign(claims: AccessTokenClaims, ttlSeconds: number): Promise<string>;
  /** Returns null for any invalid/expired/foreign token — never throws. */
  verify(token: string): Promise<(AccessTokenClaims & { exp: number; iat: number }) | null>;
}
export const TOKEN_SIGNER = Symbol('TOKEN_SIGNER');
