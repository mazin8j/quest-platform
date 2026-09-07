import { type INestApplication, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';

import { AppModule } from './app.module';
import { RequestContextMiddleware } from './common/context/request-context.middleware';
import { APP_CONFIG, type AppConfig } from './config/app-config';

/**
 * Applies the HTTP pipeline to an application instance. Shared by main.ts and by the test harness
 * so tests exercise exactly the production wiring (security headers, CORS, versioning, limits).
 */
export function configureApp(app: NestExpressApplication): INestApplication {
  const config = app.get<AppConfig>(APP_CONFIG);

  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();

  // Request/correlation ids must exist before ANY other middleware runs (body parsers, pino-http,
  // helmet) so early failures such as 413/400 and every log line carry them.
  const requestContext = new RequestContextMiddleware();
  app.use((req: Request, res: Response, next: NextFunction) => requestContext.use(req, res, next));
  // Client IP for rate limiting: trust exactly as many proxy hops as the deployment has
  // (TRUST_PROXY_HOPS — 2 for CloudFront → ALB). Anything beyond that is client-controlled.
  app.set('trust proxy', config.TRUST_PROXY_HOPS);
  app.disable('x-powered-by');

  app.use(
    helmet({
      // API only: no HTML is served, so a strict CSP and no framing are safe defaults.
      contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
      crossOriginResourcePolicy: { policy: 'same-site' },
      hsts:
        config.NODE_ENV === 'production'
          ? { maxAge: 31_536_000, includeSubDomains: true, preload: true }
          : false,
      referrerPolicy: { policy: 'no-referrer' },
    }),
  );

  app.enableCors({
    origin: config.CORS_ALLOWED_ORIGINS.length > 0 ? config.CORS_ALLOWED_ORIGINS : false,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'content-type',
      'authorization',
      'x-correlation-id',
      'x-request-id',
      'idempotency-key',
    ],
    exposedHeaders: ['x-correlation-id', 'x-request-id', 'retry-after'],
    maxAge: 600,
  });

  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  // Body limits: JSON only, small by design — media never transits the API (ADR-005).
  app.useBodyParser('json', { limit: '256kb' });
  app.useBodyParser('urlencoded', { extended: false, limit: '64kb' });

  return app;
}

export async function createApp(): Promise<INestApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    bodyParser: false,
  });
  return configureApp(app);
}
