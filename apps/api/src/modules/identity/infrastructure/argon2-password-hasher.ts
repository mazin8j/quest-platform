import { hash, parseOptions, verify } from '@node-rs/argon2';

import type { PasswordHasherPort } from '../ports/password-hasher.port';

/**
 * Argon2id (OWASP first choice). Parameters follow the OWASP minimum-recommended profile
 * (m=19 MiB, t=2, p=1); raising them later is safe because `needsRehash` triggers a rehash on
 * the next successful sign-in. `Algorithm.Argon2id` is a const enum in the typings (value 2);
 * the numeric value is used because const enums are not accessible under isolatedModules.
 */
const ARGON2ID = 2;
export const ARGON2_PARAMS = {
  algorithm: ARGON2ID,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

export class Argon2PasswordHasher implements PasswordHasherPort {
  hash(password: string): Promise<string> {
    return hash(password, ARGON2_PARAMS);
  }

  async verify(stored: string, password: string): Promise<boolean> {
    try {
      return await verify(stored, password);
    } catch {
      // Malformed hash (never expected) → treat as mismatch rather than crash the sign-in path.
      return false;
    }
  }

  needsRehash(stored: string): boolean {
    try {
      const parsed = parseOptions(stored);
      return (
        Number(parsed.algorithm) !== ARGON2ID ||
        parsed.memoryCost < ARGON2_PARAMS.memoryCost ||
        parsed.timeCost < ARGON2_PARAMS.timeCost ||
        parsed.parallelism !== ARGON2_PARAMS.parallelism
      );
    } catch {
      return true;
    }
  }
}
