# 11 — Deployment Architecture

Defined in `infrastructure/terraform` (modules + `environments/dev`); nothing is applied yet.

```mermaid
flowchart TB
  U[Users] --> CF[CloudFront<br/>WAFv2 managed rules + IP rate limit<br/>media via OAC · /v* → API]
  CF -->|x-quest-origin-secret| ALB[ALB — public subnets<br/>TLS 1.3 policy · 403 without secret]
  ALB --> ECS[ECS Fargate service quest-api<br/>private subnets · ARM64 · read-only FS · autoscaling on CPU]
  ECS --> RDS[(RDS PostgreSQL 16<br/>private · TLS forced · encrypted · PI · managed secret)]
  ECS --> EC[(ElastiCache Redis 7<br/>TLS in transit + at rest · LRU)]
  ECS --> S3[(S3 media bucket<br/>private · SSE · versioning · lifecycle · TLS-only)]
  ECS --> EB[EventBridge bus + archive] --> SQS[SQS consumer queues + DLQs + alarms]
  ECS --> SM[Secrets Manager<br/>quest/env/*]
  ECS --> CW[CloudWatch Logs<br/>5xx metric filter → alarm → SNS]
  NAT[NAT gateway ×1 dev] -.-> ECS
```

Environment awareness: `var.environment` drives multi-AZ, Fargate Spot, deletion protection,
backup retention and Redis node count. Region per ADR-008 (`me-central-1`), overridable per
environment. Remote state is S3 with partial backend config (no account values committed).

Container image: `apps/api/Dockerfile` (multi-stage, pnpm deploy, non-root, healthcheck) — built and
pushed by a deploy workflow to be added when the first environment is provisioned (out of Phase 00
scope by requirement).

Migrations in deployment: run `node dist/cli/migrate.js up` as a one-off ECS task (same image) before
rolling the service; `node dist/cli/migrate.js status` is the post-deploy check.

Runtime configuration: plain env vars from Terraform; `DATABASE_URL`/`REDIS_URL` assembled by the
deploy pipeline from module outputs and the RDS-managed secret; application secrets injected from
Secrets Manager ARNs via the task execution role.
