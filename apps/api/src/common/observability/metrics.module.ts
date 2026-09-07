import { Global, Module } from '@nestjs/common';

import { METRICS, NoopMetrics } from './metrics.port';

/** Global provider for the MetricsPort (OTel-backed implementation arrives with TD-04). */
@Global()
@Module({ providers: [{ provide: METRICS, useClass: NoopMetrics }], exports: [METRICS] })
export class MetricsModule {}
