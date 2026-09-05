import { createApiClient } from '@quest/api-client';
import type { LivenessResponse, ReadinessResponse } from '@quest/types';

import { publicEnv } from './env';

/** Admin API client. Staff auth token provider is attached with admin identity (Phase 01/14). */
export const api = createApiClient({
  baseUrl: publicEnv.NEXT_PUBLIC_API_BASE_URL,
  timeoutMs: 10_000,
});

export const getApiLiveness = () => api.get<LivenessResponse>('/health', { versionNeutral: true });
export const getApiReadiness = () => api.get<ReadinessResponse>('/ready', { versionNeutral: true });
