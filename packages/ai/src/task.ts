import type { z } from 'zod';

/**
 * An AI task is a typed capability the application asks for — never a "chat completion".
 * Every task declares its schemas so outputs are structured and validated before use.
 * Canonical documentation: docs/ai/AI_ARCHITECTURE.md, ADR-004.
 */
export interface AiTaskDefinition<TInput, TOutput> {
  /** Stable identifier, e.g. "quest.generate", "quest.safety.classify". */
  readonly taskId: string;
  readonly description: string;
  readonly inputSchema: z.ZodType<TInput>;
  readonly outputSchema: z.ZodType<TOutput>;
  /** Which prompt (by id) this task uses; the version is resolved by the registry at call time. */
  readonly promptId: string;
  /** Budget the gateway enforces. */
  readonly budget: AiTaskBudget;
  /** Risk tier decides audit depth and whether a human-review path is mandatory. */
  readonly riskTier: 'LOW' | 'MEDIUM' | 'HIGH';
  /**
   * Deterministic behaviour when AI is unavailable or fails. Every task MUST have one
   * (CLAUDE.md: "AI-native, but never AI-dependent for basic product operation").
   */
  readonly fallback: AiFallbackPolicy<TInput, TOutput>;
}

export interface AiTaskBudget {
  timeoutMs: number;
  maxRetries: number;
  /** Upper bound on total tokens; the gateway refuses to run over budget. */
  maxTotalTokens: number;
  /** Optional soft cost ceiling in micro-USD for alerting. */
  maxCostMicroUsd?: number;
}

export type AiFallbackPolicy<TInput, TOutput> =
  | { kind: 'DETERMINISTIC'; compute: (input: TInput) => TOutput }
  | { kind: 'FAIL_CLOSED'; reason: string }
  | { kind: 'DEGRADE'; value: TOutput };

export function defineAiTask<TInput, TOutput>(
  definition: AiTaskDefinition<TInput, TOutput>,
): AiTaskDefinition<TInput, TOutput> {
  if (!/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/.test(definition.taskId)) {
    throw new Error(
      `Invalid AI taskId "${definition.taskId}": use dot-separated lower-kebab segments`,
    );
  }
  if (definition.budget.timeoutMs <= 0 || definition.budget.maxTotalTokens <= 0) {
    throw new Error(`AI task ${definition.taskId}: budget must be positive`);
  }
  return Object.freeze(definition);
}
