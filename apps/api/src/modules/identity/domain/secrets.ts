import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

/**
 * Pure helpers for the secrets the Identity context handles. Only hashes are ever persisted.
 */

/** 256 bits of entropy, URL-safe. Presented to the client once; stored as sha256. */
export function generateRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Six-digit code with leading zeros; CSPRNG. ~20 bits — protected by attempt limits + expiry. */
export function generateVerificationCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

/** Codes are salted per account so a leaked table cannot be brute-forced offline in one pass. */
export function hashVerificationCode(accountId: string, code: string): string {
  return createHash('sha256').update(`${accountId}:${code}`, 'utf8').digest('hex');
}

export function constantTimeEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** Irreversible email tombstone kept after deletion for abuse correlation. */
export function emailTombstone(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase(), 'utf8').digest('hex');
}
