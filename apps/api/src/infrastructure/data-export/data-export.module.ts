import { Global, Module } from '@nestjs/common';

import { InMemoryDataExportRegistry } from './data-export-registry';
import { DATA_EXPORT_REGISTRY } from './data-export.port';

/**
 * Cross-context registry for the user-data export contract. Each bounded context registers its
 * contributor on module init; the Identity context's export job assembles the bundle.
 */
@Global()
@Module({
  providers: [{ provide: DATA_EXPORT_REGISTRY, useClass: InMemoryDataExportRegistry }],
  exports: [DATA_EXPORT_REGISTRY],
})
export class DataExportModule {}
