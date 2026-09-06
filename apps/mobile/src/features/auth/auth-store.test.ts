import { InMemoryTokenStorage, type IdentityApi } from '@quest/api-client';
import type { AccountView, AuthResponse } from '@quest/types';
import { describe, expect, it, vi } from 'vitest';

import { InMemorySecureStorage } from '../../lib/secure-storage';

import { AuthStore } from './auth-store';
import { SecureTokenStorage } from './token-storage';
import { Routes, routeForAccount } from '../onboarding/routing';

const account = (over: Partial<AccountView> = {}): AccountView => ({
  accountId: '019203f4-1c3a-7d8e-8b3b-0f4c2a1e5d66',
  email: 'a@example.com',
  emailVerified: false,
  state: 'PENDING_VERIFICATION',
  ageBand: 'ADULT',
  roles: ['USER'],
  onboarding: { completed: false, nextStep: 'VERIFY_EMAIL' },
  createdAt: '2026-09-06T00:00:00.000Z',
  deletionScheduledFor: null,
  ...over,
});
const tokens = {
  accessToken: 'a.b.c',
  accessTokenExpiresIn: 900,
  refreshToken: 'r1',
  refreshTokenExpiresAt: '2026-10-06T00:00:00.000Z',
  sessionId: '019203f4-1c3a-7d8e-8b3b-0f4c2a1e5d67',
  tokenType: 'Bearer' as const,
};

function fakeApi(): IdentityApi {
  let current = account();
  const api = {
    auth: {
      register: vi.fn((): Promise<AuthResponse> => Promise.resolve({ account: current, tokens })),
      login: vi.fn((): Promise<AuthResponse> => Promise.resolve({ account: current, tokens })),
      refresh: vi.fn((): Promise<AuthResponse> =>
        Promise.resolve({ account: current, tokens: { ...tokens, refreshToken: 'r2' } }),
      ),
      logout: vi.fn(() => Promise.resolve()),
      verifyEmail: vi.fn(() => {
        current = account({
          emailVerified: true,
          state: 'ACTIVE',
          onboarding: { completed: false, nextStep: 'PROFILE' },
        });
        return Promise.resolve(current);
      }),
      resendVerification: vi.fn(() => Promise.resolve({ accepted: true as const })),
    },
    me: { get: vi.fn(() => Promise.resolve(current)) },
  };
  return api as unknown as IdentityApi;
}

describe('onboarding routing', () => {
  it('derives the destination from the server-side account view only', () => {
    expect(routeForAccount(null)).toBe(Routes.SIGN_IN);
    expect(routeForAccount(account())).toBe(Routes.VERIFY_EMAIL);
    expect(
      routeForAccount(account({ onboarding: { completed: false, nextStep: 'PROFILE' } })),
    ).toBe(Routes.PROFILE);
    expect(
      routeForAccount(account({ onboarding: { completed: false, nextStep: 'INTERESTS' } })),
    ).toBe(Routes.INTERESTS);
    expect(routeForAccount(account({ onboarding: { completed: true, nextStep: 'DONE' } }))).toBe(
      Routes.HOME,
    );
    expect(
      routeForAccount(
        account({ state: 'DELETION_REQUESTED', onboarding: { completed: true, nextStep: 'DONE' } }),
      ),
    ).toBe(Routes.DELETION_PENDING);
  });
});

describe('SecureTokenStorage', () => {
  it('round-trips a token pair through the secure store and tolerates corruption', async () => {
    const secure = new InMemorySecureStorage();
    const storage = new SecureTokenStorage(secure);
    expect(await storage.load()).toBeNull();
    await storage.save(tokens);
    expect(await storage.load()).toEqual(tokens);
    await secure.set('quest.auth.refreshToken', 'not json');
    expect(await storage.load()).toBeNull();
    await storage.clear();
    expect(await secure.get('quest.auth.accessToken')).toBeNull();
  });
});

describe('AuthStore', () => {
  it('bootstraps signed out without tokens, signs up, verifies, and signs out', async () => {
    const api = fakeApi();
    const store = new AuthStore(api, new InMemoryTokenStorage());
    const states: string[] = [];
    store.subscribe((s) => states.push(s.status));
    expect((await store.bootstrap()).status).toBe('signedOut');
    const created = await store.signUp({
      email: 'a@example.com',
      password: 'a long enough passphrase',
      dateOfBirth: '1990-01-01',
      consents: {
        termsOfServiceVersion: '2026-09',
        privacyPolicyVersion: '2026-09',
        ageAttestation: true,
      },
    });
    expect(created.onboarding.nextStep).toBe('VERIFY_EMAIL');
    expect(await store.session.current()).toEqual(tokens);
    const verified = await store.verifyEmail('123456');
    expect(verified.emailVerified).toBe(true);
    expect(store.current).toMatchObject({ status: 'signedIn', account: { state: 'ACTIVE' } });
    await store.signOut();
    expect(store.current.status).toBe('signedOut');
    expect(await store.session.current()).toBeNull();
    expect(states).toEqual(['signedOut', 'signedIn', 'signedIn', 'signedOut']);
  });

  it('restores a stored session on bootstrap', async () => {
    const api = fakeApi();
    const storage = new InMemoryTokenStorage();
    await storage.save(tokens);
    const store = new AuthStore(api, storage);
    expect((await store.bootstrap()).status).toBe('signedIn');
  });
});
