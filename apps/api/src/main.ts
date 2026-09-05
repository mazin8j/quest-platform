import 'reflect-metadata';

import { Logger } from 'nestjs-pino';

import { createApp } from './bootstrap';
import { APP_CONFIG, type AppConfig } from './config/app-config';
import { SERVICE_NAME, SERVICE_VERSION } from './version';

async function main(): Promise<void> {
  const app = await createApp();
  const config = app.get<AppConfig>(APP_CONFIG);
  const logger = app.get(Logger);

  await app.listen(config.API_PORT, config.API_HOST);
  logger.log(
    {
      service: SERVICE_NAME,
      version: SERVICE_VERSION,
      port: config.API_PORT,
      env: config.NODE_ENV,
    },
    'QUEST API listening',
  );
}

main().catch((error: unknown) => {
  // Config validation errors surface here with a redacted, readable message.
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
