import { Controller, Get, Inject } from '@nestjs/common';

import { APP_CONFIG, type AppConfig } from '../../../config/app-config';
import { SERVICE_COMMIT, SERVICE_NAME, SERVICE_VERSION } from '../../../version';

export interface SystemInfoDto {
  service: string;
  version: string;
  commit: string;
  environment: string;
  apiVersion: string;
}

/**
 * First versioned route: GET /v1/system/info. Exposes only non-sensitive build metadata.
 * Exists to prove URI versioning, the error filter and the correlation-id plumbing end to end.
 */
@Controller({ path: 'system', version: '1' })
export class SystemController {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  @Get('info')
  info(): SystemInfoDto {
    return {
      service: SERVICE_NAME,
      version: SERVICE_VERSION,
      commit: SERVICE_COMMIT,
      environment: this.config.NODE_ENV,
      apiVersion: 'v1',
    };
  }
}
