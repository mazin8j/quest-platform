import { HttpException } from '@nestjs/common';
import { ApiErrorCode, apiErrorHttpStatus, type ValidationIssue } from '@quest/types';

/**
 * Typed application error carrying a stable ApiErrorCode. Domain modules throw these (or
 * subclasses); the ApiExceptionFilter renders the standard envelope. Never put secrets or
 * internal identifiers in `message`.
 */
export class ApiError extends HttpException {
  constructor(
    public readonly code: ApiErrorCode,
    message: string,
    public readonly issues?: ValidationIssue[],
  ) {
    super({ code, message, issues }, apiErrorHttpStatus[code]);
    this.name = 'ApiError';
  }

  static validation(issues: ValidationIssue[], message = 'Request validation failed'): ApiError {
    return new ApiError(ApiErrorCode.VALIDATION_ERROR, message, issues);
  }
  static notFound(what = 'Resource'): ApiError {
    return new ApiError(ApiErrorCode.NOT_FOUND, `${what} not found`);
  }
  static forbidden(message = 'Forbidden'): ApiError {
    return new ApiError(ApiErrorCode.FORBIDDEN, message);
  }
  static unauthenticated(message = 'Authentication required'): ApiError {
    return new ApiError(ApiErrorCode.UNAUTHENTICATED, message);
  }
  /** `issues` carries machine-readable detail (e.g. why a Quest cannot be published). */
  static conflict(message: string, issues?: ValidationIssue[]): ApiError {
    return new ApiError(ApiErrorCode.CONFLICT, message, issues);
  }
  static unavailable(message = 'Service temporarily unavailable'): ApiError {
    return new ApiError(ApiErrorCode.SERVICE_UNAVAILABLE, message);
  }
}
