import type { IncomingMessage, ServerResponse } from 'node:http';

import type { Params } from 'nestjs-pino';

import type { AppConfig } from '../../config/app-config';
import type { RequestContext } from '../context/request-context';

/** Header/body paths that must never appear in logs (docs/security/SECURITY_ARCHITECTURE.md). */
export const LOG_REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'req.headers["x-amz-security-token"]',
  'res.headers["set-cookie"]',
  '*.password',
  '*.secret',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.apiKey',
];

export function buildLoggerParams(config: AppConfig): Params {
  const pretty = config.NODE_ENV === 'development';
  return {
    pinoHttp: {
      level: config.LOG_LEVEL,
      redact: { paths: LOG_REDACT_PATHS, censor: '[redacted]' },
      // Correlate every log line with the request.
      genReqId: (req) =>
        (req as IncomingMessage & { questContext?: RequestContext }).questContext?.requestId ??
        'unknown',
      customProps: (req) => {
        const ctx = (req as IncomingMessage & { questContext?: RequestContext }).questContext;
        return { correlationId: ctx?.correlationId, actorId: ctx?.actorId };
      },
      customLogLevel: (_req, res: ServerResponse, err) => {
        if (err || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },
      // Health probes are noisy; keep them at debug.
      autoLogging: { ignore: (req) => req.url === '/health' || req.url === '/ready' },
      serializers: {
        req: (req: {
          id: string;
          method: string;
          url: string;
          headers?: Record<string, unknown>;
        }) => ({
          id: req.id,
          method: req.method,
          url: req.url,
          userAgent: req.headers?.['user-agent'],
        }),
        res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
      },
      ...(pretty
        ? {
            transport: {
              target: 'pino-pretty',
              options: { singleLine: true, translateTime: 'HH:MM:ss.l' },
            },
          }
        : {}),
    },
  };
}
