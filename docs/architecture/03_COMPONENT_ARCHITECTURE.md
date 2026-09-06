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
    THR[ThrottlerGuard — global + per-route limits]
    AUTH[AuthGuard — default deny · state · verified email · permissions<br/>PRINCIPAL_RESOLVER port]
    MET[MetricsModule · MetricsPort → NoopMetrics]
    OTEL[telemetry/otel.ts — tracer seam]
  end
  subgraph Infrastructure ports — src/infrastructure
    DB[DatabaseModule<br/>DATABASE · DATABASE_POOL]
    RDS[RedisModule · REDIS]
    OBJ[ObjectStorageModule<br/>OBJECT_STORAGE → S3 adapter]
    EVT[EventsModule<br/>EVENT_PUBLISHER · EVENT_SUBSCRIBER → InMemoryEventBus]
    AIM[AiModule · AI_GATEWAY → NotConfiguredAiGateway]
    DEX[DataExportModule · DATA_EXPORT_REGISTRY]
  end
  subgraph Domain modules — src/modules
    SYS[system<br/>GET /v1/system/info]
    TS[trust-safety<br/>SAFETY_DECISION → FailClosedSafetyDecision]
    IDN[identity — Phase 01<br/>auth · me · admin controllers<br/>Session/Registration/Authentication/Account/DataExport services · AccountDeletionJob<br/>ports: PASSWORD_HASHER · TOKEN_SIGNER · MAILER · IDENTITY_PROVIDERS]
    PRO[profiles — Phase 01<br/>me/profile · privacy · blocks · public profiles<br/>exports PROFILE_PROVISIONER · PROFILE_QUERY · BLOCK_QUERY]
    NEXT[quest, participation … — Phase 02+]
  end
  HEALTH[health<br/>GET /health · GET /ready]
  MAIN --> APPM --> CFG & CTX & LOG & FLT & THR & MET
  APPM --> DB & RDS & OBJ & EVT & AIM
  APPM --> HEALTH & SYS & TS & PRO & IDN
  IDN --> PRO
  IDN -. provides .-> AUTH
  HEALTH --> DB & RDS & OBJ
```

Request pipeline order: `RequestContextMiddleware` → pino-http → helmet/CORS → `ThrottlerGuard` →
`AuthGuard` (resolves the bearer token to a `Principal` through `PRINCIPAL_RESOLVER`, sets
`actorId` on the request context, enforces `@Public` / `@AllowStates` / `@RequireVerifiedEmail` /
`@RequirePermission`) → route → `ZodValidationPipe` (per-route) → handler → `ApiExceptionFilter`.

Module dependency direction (enforced by dependency-cruiser): `identity → profiles` through the
exported ports only; `profiles` imports nothing from `identity`; both depend on `common/`,
`config/` and `infrastructure/` ports. Cross-context contracts that need no owner (`Principal`,
`DataExportContributor`) live in `common/` and `infrastructure/`.

Module-internal layout (see `apps/api/src/modules/README.md`): `index.ts` (public), `api/`,
`application/`, `domain/`, `ports/`, `infrastructure/`. Only `index.ts` may be imported across
modules — enforced by `.dependency-cruiser.cjs`.

DI tokens are `Symbol`s exported next to their port so that swapping an implementation is a
one-line provider change (tests override `DATABASE_POOL`, `REDIS`, `OBJECT_STORAGE`).
