import { Global, Module } from '@nestjs/common';

import { APP_CONFIG, loadAppConfig, type AppConfig } from './app-config';

/**
 * Global configuration module. Provides the validated AppConfig under APP_CONFIG.
 * Modules inject `@Inject(APP_CONFIG) config: AppConfig` — never `process.env`.
 */
@Global()
@Module({})
export class AppConfigModule {
  static forRoot(source?: Record<string, string | undefined>) {
    return {
      module: AppConfigModule,
      // Loaded lazily at DI time (not at decoration time) so the environment is read when the
      // application is actually created — required for tests and for preload-based config injection.
      providers: [
        { provide: APP_CONFIG, useFactory: (): AppConfig => loadAppConfig(source ?? process.env) },
      ],
      exports: [APP_CONFIG],
    };
  }
}
