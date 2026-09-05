import { createApiClient } from '@quest/api-client';
import type { LivenessResponse } from '@quest/types';

import { publicEnv } from './env';

/**
 * Single API client instance for the web app. Works in both server components (Node fetch) and
 * client components (browser fetch). Auth token provider is attached by Identity in Phase 01.
 */
export const api = createApiClient({
  baseUrl: publicEnv.NEXT_PUBLIC_API_BASE_URL,
  timeoutMs: 10_000,
});

export function getApiLiveness(): Promise<LivenessResponse> {
  return api.get<LivenessResponse>('/health', { versionNeutral: true });
}
