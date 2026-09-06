import { createApiClient, identityApi } from '@quest/api-client';
import { type ReactNode, createContext, useContext, useEffect, useMemo, useState } from 'react';

import { env } from '../../lib/env';
import { secureStorage } from '../../lib/secure-storage.expo';

import { type AuthState, AuthStore } from './auth-store';
import { SecureTokenStorage } from './token-storage';

interface AuthContextValue {
  state: AuthState;
  store: AuthStore;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** Builds the single AuthStore for the app (API client + secure token storage). */
export function createAuthStore(): AuthStore {
  const holder: { store?: AuthStore } = {};
  const client = createApiClient({
    baseUrl: env.EXPO_PUBLIC_API_BASE_URL,
    timeoutMs: 15_000,
    getAccessToken: () => holder.store?.session.accessToken() ?? null,
  });
  holder.store = new AuthStore(identityApi(client), new SecureTokenStorage(secureStorage));
  return holder.store;
}

export function AuthProvider({ children, store }: { children: ReactNode; store?: AuthStore }) {
  const authStore = useMemo(() => store ?? createAuthStore(), [store]);
  const [state, setState] = useState<AuthState>(authStore.current);

  useEffect(() => {
    const unsubscribe = authStore.subscribe(setState);
    void authStore.bootstrap();
    return unsubscribe;
  }, [authStore]);

  const value = useMemo(() => ({ state, store: authStore }), [state, authStore]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
