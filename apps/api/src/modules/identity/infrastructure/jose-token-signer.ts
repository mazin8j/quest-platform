import { SignJWT, jwtVerify } from 'jose';

import type { AppConfig } from '../../../config/app-config';
import type { AccessTokenClaims, TokenSignerPort } from '../ports/token-signer.port';

/**
 * HS256 access tokens (ADR-011). Verification tries the current secret, then the previous one,
 * so secrets rotate without invalidating in-flight tokens (≤ access TTL). Issuer and audience are
 * always checked; `alg` is pinned so algorithm-confusion attacks are impossible.
 */
export class JoseTokenSigner implements TokenSignerPort {
  private readonly keys: Uint8Array[];

  constructor(
    private readonly config: Pick<
      AppConfig,
      'AUTH_JWT_SECRET' | 'AUTH_JWT_SECRET_PREVIOUS' | 'AUTH_JWT_ISSUER' | 'AUTH_JWT_AUDIENCE'
    >,
  ) {
    const enc = new TextEncoder();
    this.keys = [enc.encode(config.AUTH_JWT_SECRET)];
    if (config.AUTH_JWT_SECRET_PREVIOUS)
      this.keys.push(enc.encode(config.AUTH_JWT_SECRET_PREVIOUS));
  }

  async sign(claims: AccessTokenClaims, ttlSeconds: number): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const key = this.keys[0];
    if (!key) throw new Error('No signing key configured');
    return new SignJWT({ sid: claims.sid, roles: claims.roles })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(claims.sub)
      .setJti(claims.jti)
      .setIssuer(this.config.AUTH_JWT_ISSUER)
      .setAudience(this.config.AUTH_JWT_AUDIENCE)
      .setIssuedAt(now)
      .setExpirationTime(now + ttlSeconds)
      .sign(key);
  }

  async verify(token: string): Promise<(AccessTokenClaims & { exp: number; iat: number }) | null> {
    for (const key of this.keys) {
      try {
        const { payload } = await jwtVerify(token, key, {
          algorithms: ['HS256'],
          issuer: this.config.AUTH_JWT_ISSUER,
          audience: this.config.AUTH_JWT_AUDIENCE,
          clockTolerance: 5,
        });
        const sid = payload.sid;
        const roles = payload.roles;
        if (
          typeof payload.sub !== 'string' ||
          typeof payload.jti !== 'string' ||
          typeof sid !== 'string' ||
          !Array.isArray(roles) ||
          typeof payload.exp !== 'number' ||
          typeof payload.iat !== 'number'
        ) {
          return null;
        }
        return {
          sub: payload.sub,
          sid,
          jti: payload.jti,
          roles: roles.filter(
            (r): r is AccessTokenClaims['roles'][number] => typeof r === 'string',
          ),
          exp: payload.exp,
          iat: payload.iat,
        };
      } catch {
        // try the next key
      }
    }
    return null;
  }
}
