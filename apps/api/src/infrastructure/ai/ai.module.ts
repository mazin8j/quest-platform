import { Global, Module } from '@nestjs/common';
import { type AiGateway, NotConfiguredAiGateway } from '@quest/ai';

import { APP_CONFIG, type AppConfig } from '../../config/app-config';

/** DI token for the application-facing AI Gateway port (ADR-004). */
export const AI_GATEWAY = Symbol('AI_GATEWAY');

/**
 * Phase 00: AI_PROVIDER=none → NotConfiguredAiGateway (fallback policies only, no network).
 * Phase 06 adds the real gateway core + provider adapters inside packages/ai and selects them
 * here based on configuration. Feature modules inject AI_GATEWAY and never a provider.
 */
@Global()
@Module({
  providers: [
    {
      provide: AI_GATEWAY,
      useFactory: (config: AppConfig): AiGateway => {
        if (config.AI_PROVIDER !== 'none') {
          throw new Error(
            `AI_PROVIDER=${config.AI_PROVIDER} is not implemented in Phase 00; set AI_PROVIDER=none`,
          );
        }
        return new NotConfiguredAiGateway();
      },
      inject: [APP_CONFIG],
    },
  ],
  exports: [AI_GATEWAY],
})
export class AiModule {}
