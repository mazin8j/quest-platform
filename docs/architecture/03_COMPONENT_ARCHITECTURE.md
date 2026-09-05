# 03 — Component Architecture (apps/api)

```mermaid
flowchart TB
  subgraph Composition root
    MAIN[main.ts → bootstrap.ts<br/>helmet · CORS · URI versioning · body limits]
    APPM[app.module.ts]
  end
  subgraph Cross-cutting — src/common, src/config, src/telemetry
    CFG[AppConfigModule<br/>zod-validated env → APP_CONFIG]
    CTX[RequestContextMiddleware<br/>AsyncLocalStorage · x-request-id · x-correlation-id]
    LOG[nestjs-pino<br/>redaction · req/res serializers]
    FLT[ApiExceptionFilter<br/>standard error envelope]
    VAL[ZodValidationPipe]
    THR[ThrottlerGuard — global rate limit]
    MET[MetricsPort → NoopMetrics]
    OTEL[telemetry/otel.ts — tracer seam]
  end
  subgraph Infrastructure ports — src/infrastructure
    DB[DatabaseModule<br/>DATABASE · DATABASE_POOL]
    RDS[RedisModule · REDIS]
    OBJ[ObjectStorageModule<br/>OBJECT_STORAGE → S3 adapter]
    EVT[EventsModule<br/>EVENT_PUBLISHER · EVENT_SUBSCRIBER → InMemoryEventBus]
    AIM[AiModule · AI_GATEWAY → NotConfiguredAiGateway]
  end
  subgraph Domain modules — src/modules
    SYS[system<br/>GET /v1/system/info]
    TS[trust-safety<br/>SAFETY_DECISION → FailClosedSafetyDecision]
    NEXT[identity, profiles … — Phase 01+]
  end
  HEALTH[health<br/>GET /health · GET /ready]
  MAIN --> APPM --> CFG & CTX & LOG & FLT & THR & MET
  APPM --> DB & RDS & OBJ & EVT & AIM
  APPM --> HEALTH & SYS & TS
  HEALTH --> DB & RDS & OBJ
```

Request pipeline order: `RequestContextMiddleware` → pino-http → helmet/CORS → `ThrottlerGuard` →
route → `ZodValidationPipe` (per-route) → handler → `ApiExceptionFilter` (all errors).

Module-internal layout (see `apps/api/src/modules/README.md`): `index.ts` (public), `api/`,
`application/`, `domain/`, `ports/`, `infrastructure/`. Only `index.ts` may be imported across
modules — enforced by `.dependency-cruiser.cjs`.

DI tokens are `Symbol`s exported next to their port so that swapping an implementation is a
one-line provider change (tests override `DATABASE_POOL`, `REDIS`, `OBJECT_STORAGE`).
