import { z } from 'zod';

/**
 * Stable, machine-readable API error codes.
 * Canonical documentation: docs/api/API_CONVENTIONS.md
 * Codes are part of the public contract: never rename, only add.
 */
export const ApiErrorCode = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  UNSUPPORTED_MEDIA_TYPE: 'UNSUPPORTED_MEDIA_TYPE',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ApiErrorCode = (typeof ApiErrorCode)[keyof typeof ApiErrorCode];

export const apiErrorCodeSchema = z.enum(
  Object.values(ApiErrorCode) as [ApiErrorCode, ...ApiErrorCode[]],
);

/** One field-level validation problem. `path` is a JSON-pointer-like dotted path. */
export const validationIssueSchema = z.object({
  path: z.string(),
  message: z.string(),
  code: z.string().optional(),
});
export type ValidationIssue = z.infer<typeof validationIssueSchema>;

/** The standard QUEST error envelope. Every non-2xx response body has exactly this shape. */
export const apiErrorEnvelopeSchema = z.object({
  error: z.object({
    code: apiErrorCodeSchema,
    /** Human-readable, safe to show to a developer. Never contains stack traces or secrets. */
    message: z.string(),
    /** Present only for VALIDATION_ERROR. */
    issues: z.array(validationIssueSchema).optional(),
    /** Echo of the request's correlation id so a client can quote it in a support ticket. */
    correlationId: z.string(),
    /** ISO-8601 UTC timestamp. */
    timestamp: z.string(),
  }),
});
export type ApiErrorEnvelope = z.infer<typeof apiErrorEnvelopeSchema>;

/** HTTP status conventionally paired with each error code. */
export const apiErrorHttpStatus: Record<ApiErrorCode, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
};

export function isApiErrorEnvelope(value: unknown): value is ApiErrorEnvelope {
  return apiErrorEnvelopeSchema.safeParse(value).success;
}
