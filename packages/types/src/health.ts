import { z } from 'zod';

export const healthStatusSchema = z.enum(['ok', 'degraded', 'error']);
export type HealthStatus = z.infer<typeof healthStatusSchema>;

/** Liveness: the process is up. Never depends on downstream systems. */
export const livenessResponseSchema = z.object({
  status: z.literal('ok'),
  service: z.string(),
  version: z.string(),
  uptimeSeconds: z.number().nonnegative(),
  timestamp: z.string(),
});
export type LivenessResponse = z.infer<typeof livenessResponseSchema>;

export const dependencyCheckSchema = z.object({
  status: z.enum(['up', 'down']),
  latencyMs: z.number().nonnegative().optional(),
  /** Safe summary only — never a connection string, credential, or stack trace. */
  detail: z.string().optional(),
});
export type DependencyCheck = z.infer<typeof dependencyCheckSchema>;

/** Readiness: the process can serve traffic (database, cache reachable). */
export const readinessResponseSchema = z.object({
  status: healthStatusSchema,
  checks: z.record(z.string(), dependencyCheckSchema),
  timestamp: z.string(),
});
export type ReadinessResponse = z.infer<typeof readinessResponseSchema>;
