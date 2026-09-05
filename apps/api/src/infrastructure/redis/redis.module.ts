import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { Redis } from 'ioredis';

import { APP_CONFIG, type AppConfig } from '../../config/app-config';

/** DI token for the shared Redis client. */
export const REDIS = Symbol('REDIS');

/**
 * Minimal port domain code may depend on. Extended deliberately per use case (cache, rate limit,
 * leaderboard) in later phases — never a leaky "everything Redis" interface.
 * Redis is NOT a system of record (CLAUDE.md rule 11).
 */
export interface RedisPort {
  ping(): Promise<string>;
}

export function createRedisClient(config: AppConfig): Redis {
  return new Redis(config.REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 2,
    connectTimeout: 5_000,
    enableOfflineQueue: false,
    retryStrategy: (times) => Math.min(times * 200, 2_000),
  });
}

@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      useFactory: (config: AppConfig) => createRedisClient(config),
      inject: [APP_CONFIG],
    },
  ],
  exports: [REDIS],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async onApplicationShutdown(): Promise<void> {
    if (this.redis.status !== 'end') await this.redis.quit().catch(() => undefined);
  }
}
