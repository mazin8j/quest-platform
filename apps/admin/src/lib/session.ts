import 'server-only';

import { ApiClientError, createApiClient, identityApi } from '@quest/api-client';
import type { AccountView, TokenPair } from '@quest/types';
import { cookies } from 'next/headers';

import type { AdminSession } from './authz/roles';
import { publicEnv } from './env';

/**
 * Staff session for the admin console: tokens live in httpOnly, SameSite=strict cookies set by
 * the sign-in route handler; server components read them here and call the API on the staff
 * member's behalf. Access tokens are refreshed transparently via the refresh cookie.
 * Staff are ordinary QUEST accounts with staff roles — there is no separate identity store.
 */
export const ACCESS_COOKIE = 'quest_admin_at';
export const REFRESH_COOKIE = 'quest_admin_rt';

const secure = publicEnv.NEXT_PUBLIC_APP_ENV === 'production';

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
  const refreshMaxAge = Math.max(
    60,
    Math.floor((new Date(tokens.refreshTokenExpiresAt).getTime() - Date.now()) / 1000),
  );
  jar.set(REFRESH_COOKIE, tokens.refreshToken, cookieOptions(refreshMaxAge));
}

export async function clearTokens(): Promise<void> {
  const jar = await cookies();
  jar.delete(ACCESS_COOKIE);
  jar.delete(REFRESH_COOKIE);
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
    return { session: { staffId: account.accountId, roles: account.roles }, account, accessToken };
  } catch (error) {
    if (error instanceof ApiClientError && error.status === 401) return null;
    throw error;
  }
}

export function toAdminSession(account: AccountView): AdminSession {
  return { staffId: account.accountId, roles: account.roles };
}
