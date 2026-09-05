/**
 * OpenTelemetry readiness. Phase 00 ships the API-level seam (a tracer obtained through
 * @opentelemetry/api) so code can create spans today; when OTEL_ENABLED=true a NodeSDK with
 * OTLP exporters is expected to be registered in a preload (`node --require ./dist/telemetry/sdk.js`)
 * — added with the first deployed environment in Phase 01/DevOps hardening.
 * Without an SDK registered, @opentelemetry/api returns no-op tracers: zero overhead, no errors.
 * Production strategy: docs/architecture/12_OBSERVABILITY_ARCHITECTURE.md
 */
import { trace, type Tracer } from '@opentelemetry/api';

import { SERVICE_NAME, SERVICE_VERSION } from '../version';

export function getTracer(scope = SERVICE_NAME): Tracer {
  return trace.getTracer(scope, SERVICE_VERSION);
}
