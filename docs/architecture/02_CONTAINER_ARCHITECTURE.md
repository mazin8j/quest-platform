# 02 — Container Architecture

```mermaid
flowchart TB
  subgraph Clients
    MOB[apps/mobile<br/>Expo SDK 57 · expo-router]
    WEB[apps/web<br/>Next.js 16 · :3000]
    ADM[apps/admin<br/>Next.js 16 · :3001]
  end
  subgraph Edge — AWS only
    CF[CloudFront + WAFv2]
    ALB[ALB — requires CloudFront shared-secret header]
  end
  subgraph Application
    API[apps/api — NestJS 12 · :4000<br/>ECS Fargate task]
    WRK[Async workers<br/>same image, SQS consumer entrypoint — Phase 05+]
  end
  subgraph Data tier
    PG[(PostgreSQL 16<br/>PostGIS 3.4 · pgvector)]
    RD[(Redis 7<br/>cache · counters · rate limits)]
    S3[(Object storage<br/>MinIO local · S3 cloud)]
    EB[EventBridge bus → SQS + DLQ]
    SM[Secrets Manager]
  end
  MOB & WEB & ADM --> CF --> ALB --> API
  MOB & WEB -->|pre-signed PUT| S3
  API --> PG & RD & S3 & EB & SM
  EB --> WRK --> PG & S3
```

| Container      | Technology                                                      | Exists in Phase 00                   | Notes                                           |
| -------------- | --------------------------------------------------------------- | ------------------------------------ | ----------------------------------------------- |
| apps/api       | NestJS 12, Node 22, Express, pino, drizzle, ioredis, AWS SDK v3 | Yes — boots, tested                  | `Dockerfile` multi-stage, non-root              |
| apps/mobile    | React Native 0.86 / Expo 57 / expo-router                       | Yes — bundles via Metro              | No screens beyond shell                         |
| apps/web       | Next.js 16 app router                                           | Yes — builds                         | `/`, `/status`                                  |
| apps/admin     | Next.js 16 app router                                           | Yes — builds                         | Role-aware gate placeholder                     |
| Workers        | Same codebase, different entrypoint                             | No                                   | Added with first cross-process consumer         |
| PostgreSQL     | 16 + PostGIS + pgvector                                         | Yes — docker compose + migrations    | RDS module in Terraform                         |
| Redis          | 7                                                               | Yes — docker compose, ioredis module | ElastiCache module                              |
| Object storage | MinIO / S3                                                      | Yes — compose + adapter              | S3 module, CloudFront OAC                       |
| Events         | In-process bus locally                                          | Yes                                  | EventBridge/SQS Terraform module; adapter later |
| AI Gateway     | `packages/ai` contracts                                         | Interfaces only                      | No provider called                              |

Shared packages (`packages/*`) are compile-time libraries, not runtime containers:
`types`, `config`, `events`, `ai`, `ui`, `analytics`, `api-client`.
