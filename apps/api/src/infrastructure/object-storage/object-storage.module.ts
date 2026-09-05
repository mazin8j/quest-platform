import { Global, Module } from '@nestjs/common';

import { APP_CONFIG, type AppConfig } from '../../config/app-config';
import { OBJECT_STORAGE } from './object-storage.port';
import { S3ObjectStorageAdapter, createS3Client } from './s3-object-storage.adapter';

@Global()
@Module({
  providers: [
    {
      provide: OBJECT_STORAGE,
      useFactory: (config: AppConfig) =>
        new S3ObjectStorageAdapter(createS3Client(config), config.S3_BUCKET),
      inject: [APP_CONFIG],
    },
  ],
  exports: [OBJECT_STORAGE],
})
export class ObjectStorageModule {}
