import { z } from 'zod';

import { aiUsageSchema } from './provider';

/**
 * One record per gateway invocation (CLAUDE.md rule 6: traceable prompt/version/model metadata).
 * Never stores raw prompts containing user PII by default — `promptHash` + registry version are
 * sufficient to reproduce; raw capture is opt-in per task with a retention policy.
 */
export const aiInvocationRecordSchema = z.object({
  invocationId: z.uuid(),
  taskId: z.string().min(1),
  promptId: z.string().min(1),
  promptVersion: z.number().int().positive(),
  /** SHA-256 of the fully rendered prompt (no PII stored). */
  promptHash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  providerId: z.string().min(1),
  modelId: z.string().min(1),
  correlationId: z.string().min(1),
  /** Acting principal id where relevant — never name/email. */
  actorId: z.string().optional(),
  startedAt: z.iso.datetime(),
  latencyMs: z.number().nonnegative(),
  usage: aiUsageSchema.nullable(),
  outcome: z.enum([
    'SUCCESS',
    'INVALID_OUTPUT',
    'TIMEOUT',
    'PROVIDER_ERROR',
    'BUDGET_EXCEEDED',
    'FALLBACK_USED',
    'REFUSED',
  ]),
  /** Number of retry attempts actually made. */
  attempts: z.number().int().nonnegative(),
  fallbackKind: z.enum(['DETERMINISTIC', 'FAIL_CLOSED', 'DEGRADE']).optional(),
  /** Safe, short error summary — no stack traces, no secrets. */
  errorSummary: z.string().max(500).optional(),
  /** Whether output was used for a user-facing / safety / ranking decision (raises retention). */
  decisionBearing: z.boolean().default(false),
});
export type AiInvocationRecord = z.infer<typeof aiInvocationRecordSchema>;

/** Sink for audit records; Phase 06 implements a PostgreSQL-backed sink. */
export interface AiAuditSink {
  record(entry: AiInvocationRecord): Promise<void>;
}

/** Evaluation hook: receives (input, output, record) so offline eval datasets can be built. */
export interface AiEvaluationHook {
  onInvocation(sample: {
    taskId: string;
    input: unknown;
    output: unknown;
    record: AiInvocationRecord;
  }): Promise<void>;
}

export class InMemoryAiAuditSink implements AiAuditSink {
  readonly records: AiInvocationRecord[] = [];
  record(entry: AiInvocationRecord): Promise<void> {
    this.records.push(aiInvocationRecordSchema.parse(entry));
    return Promise.resolve();
  }
}
