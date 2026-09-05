import { createApiClient } from '@quest/api-client';
import type { LivenessResponse } from '@quest/types';

import { env } from './env';
import { SecureStorageKey } from './secure-storage';
import { secureStorage } from './secure-storage.expo';

/**
 * Single API client for the app. The access-token provider reads from secure storage so the
 * client is already auth-ready for Phase 01 without any change to feature code.
 */
export const api = createApiClient({
  baseUrl: env.EXPO_PUBLIC_API_BASE_URL,
  timeoutMs: 15_000,
  getAccessToken: () => secureStorage.get(SecureStorageKey.ACCESS_TOKEN),
});

export const getApiLiveness = () => api.get<LivenessResponse>('/health', { versionNeutral: true });
