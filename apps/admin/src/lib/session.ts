import 'server-only';

import { ApiClientError, createApiClient, identityApi } from '@quest/api-client';
import { type AccountView, type TokenPair, isStaff } from '@quest/types';
import { cookies } from 'next/headers';

import type { AdminSession } from './authz/roles';
import { publicEnv } from './env';

/**
 * Staff session for the admin console: the access token lives in an httpOnly, SameSite=strict,
 * Secure (outside local development) cookie set by the sign-in route handler; server components
 * read it here and call the API on the staff member's behalf. The console deliberately does NOT
 * keep the refresh token: a staff session lasts one access-token TTL and then requires sign-in
 * again (transparent refresh for staff is TD-24, together with staff MFA).
 * Staff are ordinary QUEST accounts with staff roles — there is no separate identity store.
 */
export const ACCESS_COOKIE = 'quest_admin_at';

const secure = publicEnv.NEXT_PUBLIC_APP_ENV !== 'development';

export function cookieOptions(maxAgeSeconds: number) {
  return { httpOnly: true, sameSite: 'strict' as const, secure, path: '/', maxAge: maxAgeSeconds };
}

export function apiFor(accessToken?: string | null) {
  return identityApi(
    createApiClient({
      baseUrl: publicEnv.NEXT_PUBLIC_API_BASE_URL,
      timeoutMs: 10_000,
      getAccessToken: () => accessToken ?? null,
    }),
  );
}

export async function storeTokens(tokens: TokenPair): Promise<void> {
  const jar = await cookies();
  jar.set(ACCESS_COOKIE, tokens.accessToken, cookieOptions(tokens.accessTokenExpiresIn));
}

export async function clearTokens(): Promise<void> {
  const jar = await cookies();
  jar.delete(ACCESS_COOKIE);
}

export interface StaffContext {
  session: AdminSession;
  account: AccountView;
  accessToken: string;
}

/** Resolves the staff context from cookies, or null when signed out / not staff. */
export async function getStaffContext(): Promise<StaffContext | null> {
  const jar = await cookies();
  const accessToken = jar.get(ACCESS_COOKIE)?.value ?? null;
  if (!accessToken) return null;
  try {
    const account = await apiFor(accessToken).me.get();
    // A non-staff token in the console cookie is never a session (defence in depth: the sign-in
    // handler already refuses non-staff accounts).
    if (!isStaff(account.roles)) return null;
    return { session: { staffId: account.accountId, roles: account.roles }, account, accessToken };
  } catch (error) {
    if (error instanceof ApiClientError && error.status === 401) return null;
    throw error;
  }
}
