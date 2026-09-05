import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiErrorCode,
  apiErrorHttpStatus,
  type ApiErrorEnvelope,
  type ValidationIssue,
} from '@quest/types';
import type { Request, Response } from 'express';
import { Logger } from 'nestjs-pino';

import type { RequestContext } from '../context/request-context';
import { ApiError } from './api-error';

/** Maps framework HTTP statuses to stable API codes; anything unmapped is INTERNAL_ERROR. */
const STATUS_TO_CODE: Readonly<Record<number, ApiErrorCode>> = {
  [HttpStatus.BAD_REQUEST]: ApiErrorCode.VALIDATION_ERROR,
  [HttpStatus.UNPROCESSABLE_ENTITY]: ApiErrorCode.VALIDATION_ERROR,
  [HttpStatus.UNAUTHORIZED]: ApiErrorCode.UNAUTHENTICATED,
  [HttpStatus.FORBIDDEN]: ApiErrorCode.FORBIDDEN,
  [HttpStatus.NOT_FOUND]: ApiErrorCode.NOT_FOUND,
  [HttpStatus.CONFLICT]: ApiErrorCode.CONFLICT,
  [HttpStatus.PAYLOAD_TOO_LARGE]: ApiErrorCode.PAYLOAD_TOO_LARGE,
  [HttpStatus.UNSUPPORTED_MEDIA_TYPE]: ApiErrorCode.UNSUPPORTED_MEDIA_TYPE,
  [HttpStatus.TOO_MANY_REQUESTS]: ApiErrorCode.RATE_LIMITED,
  [HttpStatus.SERVICE_UNAVAILABLE]: ApiErrorCode.SERVICE_UNAVAILABLE,
};

function codeForStatus(status: number): ApiErrorCode {
  return STATUS_TO_CODE[status] ?? ApiErrorCode.INTERNAL_ERROR;
}

interface ClientErrorLike {
  status: number;
  message: string;
  type?: string;
  expose?: boolean;
}

function isClientErrorLike(e: unknown): e is ClientErrorLike {
  if (typeof e !== 'object' || e === null) return false;
  const status =
    (e as { status?: unknown; statusCode?: unknown }).status ??
    (e as { statusCode?: unknown }).statusCode;
  return typeof status === 'number' && status >= 400 && status < 500;
}

/**
 * Renders EVERY error as the standard envelope (docs/api/API_CONVENTIONS.md).
 * - ApiError → its code/message/issues
 * - other HttpException → mapped code, framework message (safe)
 * - anything else → INTERNAL_ERROR with a generic message; details go to the log only.
 */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: Logger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const res = http.getResponse<Response>();
    const req = http.getRequest<Request & { questContext?: RequestContext }>();
    const correlationId = req.questContext?.correlationId ?? 'unknown';

    let status: number;
    let code: ApiErrorCode;
    let message: string;
    let issues: ValidationIssue[] | undefined;

    if (exception instanceof ApiError) {
      status = exception.getStatus();
      code = exception.code;
      message = exception.message;
      issues = exception.issues;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      code = codeForStatus(status);
      const body = exception.getResponse();
      message =
        typeof body === 'string'
          ? body
          : ((body as { message?: string | string[] }).message?.toString() ?? exception.message);
      if (status >= 500) message = 'Internal server error';
    } else if (isClientErrorLike(exception)) {
      // Express/body-parser errors (entity.too.large, entity.parse.failed, charset.unsupported…)
      status = exception.status;
      code = codeForStatus(status);
      message =
        exception.type === 'entity.parse.failed'
          ? 'Malformed request body'
          : exception.expose
            ? exception.message
            : 'Bad request';
    } else {
      status = apiErrorHttpStatus[ApiErrorCode.INTERNAL_ERROR];
      code = ApiErrorCode.INTERNAL_ERROR;
      message = 'Internal server error';
    }

    if (status >= 500) {
      this.logger.error(
        {
          err:
            exception instanceof Error
              ? { name: exception.name, message: exception.message, stack: exception.stack }
              : exception,
          correlationId,
          code,
        },
        'Unhandled server error',
      );
    }

    const envelope: ApiErrorEnvelope = {
      error: {
        code,
        message,
        ...(issues ? { issues } : {}),
        correlationId,
        timestamp: new Date().toISOString(),
      },
    };
    res.status(status).json(envelope);
  }
}
