# QUEST infrastructure (Terraform)

Modular, environment-aware AWS baseline (ADR-008 region, ADR-001 monolith, ADR-003 messaging,
ADR-005 media). **Nothing here is applied automatically**; CI only runs `fmt`/`validate`.

```
modules/
  networking/         VPC, 2 AZ public/private subnets, NAT (count configurable), S3 endpoint, flow logs
  ecs-service/        ECS Fargate cluster + API service, ALB, IAM (least privilege), autoscaling
  rds-postgres/       PostgreSQL 16 (RDS-managed master secret, TLS forced, encrypted, PI enabled)
  elasticache-redis/  Redis 7 (TLS + at-rest encryption, LRU eviction — cache only)
  s3-media/           Private media bucket (SSE, versioning, CORS for pre-signed PUT, lifecycle, TLS-only policy)
  cdn-waf/            CloudFront (media via OAC + API path) with WAFv2 managed rules + rate limit
                      (needs provider alias aws.us_east_1 → validated via examples/validate, not standalone)
  messaging/          EventBridge bus + archive, SQS consumer queues with DLQs and alarms
  secrets/            Secrets Manager containers (values never in Terraform)
  observability/      Log group, 5xx metric filter/alarm, RDS alarms, SNS alerts topic
environments/
  dev/                Composition root for the dev account; staging/production are copies with different tfvars
```

## Usage

```bash
cd infrastructure/terraform/environments/dev
cp dev.tfvars.example dev.tfvars            # edit; git-ignored
terraform init \
  -backend-config="bucket=<state-bucket>" \
  -backend-config="key=quest/dev/terraform.tfstate" \
  -backend-config="region=me-central-1" \
  -backend-config="dynamodb_table=<lock-table>"
terraform plan -var-file=dev.tfvars
```

The CloudFront→ALB shared secret is passed as `TF_VAR_cdn_origin_shared_secret` from Secrets
Manager at plan time. `DATABASE_URL`/`REDIS_URL` for the API task are assembled by the deploy
pipeline from module outputs and the RDS-managed secret — they are never Terraform inputs.

## Cost posture (dev)

Single NAT gateway, Fargate Spot, `db.t4g.medium` single-AZ, `cache.t4g.micro`, 14-day logs,
PriceClass_200 CDN. Production flips: multi-AZ RDS, 2-node Redis with failover, on-demand
Fargate, deletion protection, longer retention — all driven by `var.environment`.
