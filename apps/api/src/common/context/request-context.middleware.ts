import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

import {
  CORRELATION_ID_HEADER,
  REQUEST_ID_HEADER,
  createRequestContext,
  runWithRequestContext,
} from './request-context';

/**
 * Establishes the per-request AsyncLocalStorage context and echoes ids to the client.
 * Must be registered for all routes before any other middleware that logs.
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const ctx = createRequestContext(req.header(CORRELATION_ID_HEADER));
    res.setHeader(REQUEST_ID_HEADER, ctx.requestId);
    res.setHeader(CORRELATION_ID_HEADER, ctx.correlationId);
    // Expose for pino-http's customProps and for filters that only have the raw request.
    (req as Request & { questContext?: typeof ctx }).questContext = ctx;
    runWithRequestContext(ctx, () => next());
  }
}
