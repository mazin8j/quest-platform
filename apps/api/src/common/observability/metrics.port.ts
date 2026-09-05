/**
 * Metrics abstraction. Domain code records business metrics through this port; the
 * implementation (OpenTelemetry meter → CloudWatch EMF/OTLP) is wired in infrastructure.
 * Names: `quest.<context>.<metric>` with unit suffix where relevant, e.g. `quest.http.request.duration_ms`.
 */
export interface MetricsPort {
  increment(name: string, value?: number, attributes?: MetricAttributes): void;
  histogram(name: string, value: number, attributes?: MetricAttributes): void;
  gauge(name: string, value: number, attributes?: MetricAttributes): void;
}

/** Attribute values must be low-cardinality: never user ids, never free text. */
export type MetricAttributes = Record<string, string | number | boolean>;

export const METRICS = Symbol('METRICS');

/** Default implementation until an exporter is configured (OTEL_ENABLED=true). */
export class NoopMetrics implements MetricsPort {
  increment(): void {
    /* no-op */
  }
  histogram(): void {
    /* no-op */
  }
  gauge(): void {
    /* no-op */
  }
}
