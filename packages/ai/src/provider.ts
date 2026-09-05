import { z } from 'zod';

/**
 * Provider adapter port — the ONLY place a vendor SDK may be touched (packages/ai/src/adapters/*,
 * Phase 06). Feature code never sees provider or model identifiers (CLAUDE.md rule 5 & 13).
 */
export interface AiProviderAdapter {
  /** Stable provider id, e.g. "anthropic", "openai", "bedrock". Configuration-driven, not hardcoded in features. */
  readonly providerId: string;
  /** Structured completion: the adapter is responsible for asking the model for JSON matching `outputJsonSchema`. */
  complete(request: AiProviderRequest, signal: AbortSignal): Promise<AiProviderResponse>;
  /** Cheap liveness probe used by readiness/observability, must not consume model tokens. */
  ping?(): Promise<boolean>;
}

export interface AiProviderRequest {
  /** Provider-specific model identifier, resolved by the ModelRouter from configuration. */
  modelId: string;
  systemPrompt?: string;
  userPrompt: string;
  /** JSON schema describing the expected structured output. */
  outputJsonSchema: Record<string, unknown>;
  maxOutputTokens: number;
  temperature?: number;
  /** Idempotency / trace key forwarded to the provider where supported. */
  requestId: string;
}

export const aiUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  /** Estimated by the adapter from its price table; null when unknown. */
  estimatedCostMicroUsd: z.number().int().nonnegative().nullable(),
});
export type AiUsage = z.infer<typeof aiUsageSchema>;

export interface AiProviderResponse {
  /** Raw structured output (already JSON-parsed); the gateway validates it against the task schema. */
  output: unknown;
  usage: AiUsage;
  modelId: string;
  providerRequestId?: string;
  /** Provider-side moderation/safety flags, surfaced to the audit record. */
  providerSafetyFlags?: string[];
  stopReason?: 'end' | 'max_tokens' | 'refusal' | 'error';
}

/**
 * Model routing policy: maps a task (and optionally risk tier / environment) to an ordered list of
 * provider+model candidates. Configuration-driven; lives in config, not code.
 */
export const modelRouteSchema = z.object({
  providerId: z.string().min(1),
  modelId: z.string().min(1),
  /** Ordered fallback candidates tried when the primary fails or times out. */
  fallbacks: z
    .array(z.object({ providerId: z.string().min(1), modelId: z.string().min(1) }))
    .default([]),
  temperature: z.number().min(0).max(2).optional(),
  maxOutputTokens: z.number().int().positive(),
});
export type ModelRoute = z.infer<typeof modelRouteSchema>;

export interface ModelRouter {
  /** Resolve the route for a task; throws AiNotConfiguredError when no route is configured. */
  route(taskId: string): ModelRoute;
}

export class AiNotConfiguredError extends Error {
  constructor(taskId: string) {
    super(`No AI model route configured for task "${taskId}"`);
    this.name = 'AiNotConfiguredError';
  }
}

/** Simple configuration-backed router: exact task match, then "*" default. */
export class ConfigModelRouter implements ModelRouter {
  private readonly routes: Map<string, ModelRoute>;

  constructor(routes: Record<string, ModelRoute>) {
    this.routes = new Map(Object.entries(routes).map(([k, v]) => [k, modelRouteSchema.parse(v)]));
  }

  route(taskId: string): ModelRoute {
    const r = this.routes.get(taskId) ?? this.routes.get('*');
    if (!r) throw new AiNotConfiguredError(taskId);
    return r;
  }
}
