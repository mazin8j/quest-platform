import type { AuthResponse, TokenPair } from '@quest/types';
import { describe, expect, it, vi } from 'vitest';

import { ApiClientError, createApiClient } from './index';
import { AuthSession, InMemoryTokenStorage, identityApi, withAuthRetry } from './identity';

const tokens = (suffix: string, expiresIn = 900): TokenPair => ({
  accessToken: `access-${suffix}`,
  accessTokenExpiresIn: expiresIn,
  refreshToken: `refresh-${suffix}`,
  refreshTokenExpiresAt: '2026-10-06T00:00:00.000Z',
  sessionId: '019203f4-1c3a-7d8e-8b3b-0f4c2a1e5d66',
  tokenType: 'Bearer',
});
const authResponse = (t: TokenPair): AuthResponse => ({
  account: {
    accountId: '019203f4-1c3a-7d8e-8b3b-0f4c2a1e5d67',
    email: 'a@example.com',
    emailVerified: true,
    state: 'ACTIVE',
    ageBand: 'ADULT',
    roles: ['USER'],
    hasPassword: true,
    linkedProviders: [],
    onboarding: { completed: true, nextStep: 'DONE' },
    createdAt: '2026-09-06T00:00:00.000Z',
    deletionScheduledFor: null,
  },
  tokens: t,
});

describe('identityApi', () => {
  it('targets the documented paths with the bearer token and JSON bodies', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = ((url: string, init: RequestInit) => {
      calls.push({ url, init });
      return Promise.resolve(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }) as unknown as typeof fetch;
    const client = createApiClient({
      baseUrl: 'https://api.test',
      fetchImpl,
      getAccessToken: () => 'tok',
    });
    const api = identityApi(client);
    await api.auth.login({ email: 'a@example.com', password: 'secret secret' });
    await api.profile.update({ displayName: 'Ragad' });
    await api.public.usernameAvailability('ragad d');
    await api.me.revokeSession('sess/1');
    expect(calls.map((c) => `${c.init.method} ${c.url}`)).toEqual([
      'POST https://api.test/v1/auth/login',
      'PUT https://api.test/v1/me/profile',
      'GET https://api.test/v1/profiles/username-availability?username=ragad+d',
      'DELETE https://api.test/v1/me/sessions/sess%2F1',
    ]);
    expect((calls[0]?.init.headers as Record<string, string>).authorization).toBe('Bearer tok');
  });
});

describe('AuthSession', () => {
  it('loads tokens from storage and refreshes proactively before expiry', async () => {
    const storage = new InMemoryTokenStorage();
    await storage.save(tokens('one', 60));
    let now = 1_000_000;
    const refresh = vi.fn(() => Promise.resolve(authResponse(tokens('two', 60))));
    const session = new AuthSession({ storage, refresh, now: () => now, refreshSkewSeconds: 10 });
    expect(await session.accessToken()).toBe('access-one');
    now += 55_000; // within skew of the 60 s expiry
    expect(await session.accessToken()).toBe('access-two');
    expect(refresh).toHaveBeenCalledWith('refresh-one');
    expect((await storage.load())?.refreshToken).toBe('refresh-two');
  });

  it('single-flights concurrent refreshes and signs out when the refresh is rejected', async () => {
    const storage = new InMemoryTokenStorage();
    await storage.save(tokens('one'));
    const refresh = vi.fn(() => Promise.resolve(authResponse(tokens('two'))));
    const onSignedOut = vi.fn();
    const session = new AuthSession({ storage, refresh, onSignedOut });
    const [a, b] = await Promise.all([session.refresh(), session.refresh()]);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(a?.accessToken).toBe('access-two');
    expect(b?.accessToken).toBe('access-two');

    const rejecting = new AuthSession({
      storage,
      refresh: () => Promise.reject(new ApiClientError(401, 'UNAUTHENTICATED', 'nope')),
      onSignedOut,
    });
    expect(await rejecting.refresh()).toBeNull();
    expect(onSignedOut).toHaveBeenCalledTimes(1);
    expect(await storage.load()).toBeNull();
  });

  it('keeps tokens on network failures and retries a call exactly once after a 401', async () => {
    const storage = new InMemoryTokenStorage();
    await storage.save(tokens('one'));
    const session = new AuthSession({
      storage,
      refresh: () => Promise.reject(new ApiClientError(0, 'NETWORK_ERROR', 'offline')),
    });
    await expect(session.refresh()).rejects.toThrow('offline');
    expect(await storage.load()).not.toBeNull();

    const ok = new AuthSession({
      storage,
      refresh: () => Promise.resolve(authResponse(tokens('two'))),
    });
    let attempts = 0;
    const result = await withAuthRetry(ok, () => {
      attempts += 1;
      if (attempts === 1)
        return Promise.reject(new ApiClientError(401, 'UNAUTHENTICATED', 'expired'));
      return Promise.resolve('done');
    });
    expect(result).toBe('done');
    expect(attempts).toBe(2);
    await expect(
      withAuthRetry(ok, () => Promise.reject(new ApiClientError(403, 'FORBIDDEN', 'no'))),
    ).rejects.toMatchObject({ status: 403 });
  });
});
