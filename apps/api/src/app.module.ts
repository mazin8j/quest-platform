import {
  type ExecutionContext,
  type MiddlewareConsumer,
  Module,
  type NestModule,
} from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';

import { RequestContextMiddleware } from './common/context/request-context.middleware';
import { ApiExceptionFilter } from './common/filters/api-exception.filter';
import { buildLoggerParams } from './common/logging/logger-params';
import { METRICS, NoopMetrics } from './common/observability/metrics.port';
import { APP_CONFIG, type AppConfig } from './config/app-config';
import { AppConfigModule } from './config/config.module';
import { HealthModule } from './health/health.module';
import { AiModule } from './infrastructure/ai/ai.module';
import { DatabaseModule } from './infrastructure/database/database.module';
import { EventsModule } from './infrastructure/events/events.module';
import { ObjectStorageModule } from './infrastructure/object-storage/object-storage.module';
import { RedisModule } from './infrastructure/redis/redis.module';
import { SystemModule } from './modules/system';
import { TrustSafetyModule } from './modules/trust-safety';

/**
 * Composition root. Order matters only for readability: config → cross-cutting → infrastructure
 * ports → domain modules. Domain modules never import this file (dependency rule).
 */
@Module({
  imports: [
    AppConfigModule.forRoot(),
    LoggerModule.forRootAsync({
      useFactory: (config: AppConfig) => buildLoggerParams(config),
      inject: [APP_CONFIG],
    }),
    ThrottlerModule.forRootAsync({
      imports: [],
      useFactory: (config: AppConfig) => ({
        // In-memory storage in Phase 00; swap to a Redis storage adapter when running >1 replica.
        throttlers: [
          {
            name: 'global',
            ttl: config.RATE_LIMIT_TTL_SECONDS * 1000,
            limit: config.RATE_LIMIT_MAX_REQUESTS,
          },
        ],
        skipIf: (ctx: ExecutionContext) => {
          const url = ctx.switchToHttp().getRequest<{ url?: string }>().url ?? '';
          return url === '/health' || url === '/ready';
        },
      }),
      inject: [APP_CONFIG],
    }),
    DatabaseModule,
    RedisModule,
    ObjectStorageModule,
    EventsModule,
    AiModule,
    HealthModule,
    // ---- domain modules ----
    SystemModule,
    TrustSafetyModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: ApiExceptionFilter },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: METRICS, useClass: NoopMetrics },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes('*path');
  }
}
