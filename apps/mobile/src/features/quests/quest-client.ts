import { type QuestsApi, createApiClient, questsApi, withAuthRetry } from '@quest/api-client';
import { useCallback, useMemo } from 'react';

import { env } from '../../lib/env';
import { useAuth } from '../auth/AuthProvider';

/**
 * Typed Quest API bound to the signed-in session.
 *
 * It builds its own `ApiClient` over the same base URL and reads the access token from the
 * AuthStore's session, so token refresh and sign-out stay in one place (Identity) and the Quest
 * feature never touches storage or tokens itself.
 */
export function useQuests(): {
  api: QuestsApi;
  call: <T>(fn: (api: QuestsApi) => Promise<T>) => Promise<T>;
} {
  const { store } = useAuth();
  const api = useMemo(
    () =>
      questsApi(
        createApiClient({
          baseUrl: env.EXPO_PUBLIC_API_BASE_URL,
          timeoutMs: 15_000,
          getAccessToken: () => store.session.accessToken() ?? null,
        }),
      ),
    [store],
  );
  const call = useCallback(
    <T>(fn: (client: QuestsApi) => Promise<T>): Promise<T> =>
      withAuthRetry(store.session, () => fn(api)),
    [api, store],
  );
  return { api, call };
}
