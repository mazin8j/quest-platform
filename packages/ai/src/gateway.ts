import type { AiTaskDefinition } from './task';

export interface AiInvocationContext {
  correlationId: string;
  actorId?: string;
  /** True when the output will drive a safety/proof/ranking/user-facing decision. */
  decisionBearing?: boolean;
  /** Optional pinned prompt version for reproducibility (evals, appeals). */
  promptVersion?: number;
}

export interface AiInvocationResult<TOutput> {
  output: TOutput;
  /** SUCCESS when the model produced it; FALLBACK when a fallback policy produced it. */
  source: 'MODEL' | 'FALLBACK';
  invocationId: string;
}

/**
 * The application-facing port. Feature modules depend on THIS and on task definitions only.
 * The gateway owns: input validation → prompt resolution → model routing → timeout/retry →
 * output validation → fallback → audit → evaluation hook.
 */
export interface AiGateway {
  invoke<TInput, TOutput>(
    task: AiTaskDefinition<TInput, TOutput>,
    input: TInput,
    context: AiInvocationContext,
  ): Promise<AiInvocationResult<TOutput>>;
}

export class AiGatewayUnavailableError extends Error {
  constructor(taskId: string, reason: string) {
    super(`AI gateway unavailable for task "${taskId}": ${reason}`);
    this.name = 'AiGatewayUnavailableError';
  }
}

/**
 * Phase 00 default: no provider is configured. Applies the task's fallback policy deterministically
 * so the product keeps working without AI; FAIL_CLOSED tasks throw a typed error.
 */
export class NotConfiguredAiGateway implements AiGateway {
  invoke<TInput, TOutput>(
    task: AiTaskDefinition<TInput, TOutput>,
    input: TInput,
    _context: AiInvocationContext,
  ): Promise<AiInvocationResult<TOutput>> {
    try {
      const validInput = task.inputSchema.parse(input);
      const invocationId = 'not-configured';
      switch (task.fallback.kind) {
        case 'DETERMINISTIC':
          return Promise.resolve({
            output: task.outputSchema.parse(task.fallback.compute(validInput)),
            source: 'FALLBACK',
            invocationId,
          });
        case 'DEGRADE':
          return Promise.resolve({
            output: task.outputSchema.parse(task.fallback.value),
            source: 'FALLBACK',
            invocationId,
          });
        case 'FAIL_CLOSED':
          return Promise.reject(new AiGatewayUnavailableError(task.taskId, task.fallback.reason));
      }
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }
}
