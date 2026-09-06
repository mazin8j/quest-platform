# 09 — Security Architecture

Canonical control list: [`docs/security/SECURITY_ARCHITECTURE.md`](../security/SECURITY_ARCHITECTURE.md).
Summary of what Phase 00 implements versus plans:

| Control                    | Phase 00 status                                                                                                                                        |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Secrets externalised       | `.env.example` has no secrets; config validated at boot; Terraform uses Secrets Manager containers + RDS-managed secret; none in state/tfvars          |
| Environment validation     | zod schema with production hardening rules (`DATABASE_SSL`, no debug logs, no local S3) — tested                                                       |
| Security headers           | helmet on API; CSP/XFO/Referrer/Permissions-Policy on web & admin                                                                                      |
| CORS                       | allow-list from config; credentials only for listed origins — tested                                                                                   |
| Input validation           | `ZodValidationPipe`, unknown keys stripped — tested                                                                                                    |
| Rate limiting              | global throttler (config-driven) — tested; WAF rate rule at edge                                                                                       |
| Authentication (Phase 01)  | Argon2id passwords, HS256 access tokens + rotating refresh tokens with reuse detection, per-account lockout, OIDC provider adapters (ADR-011) — tested |
| Authorization              | server-side RBAC: global default-deny `AuthGuard`, roles ledger, shared vocabulary with the admin console (presentation gate) — tested                 |
| Identity threat model      | `docs/security/IDENTITY_THREAT_MODEL.md` (STRIDE, 21 threats mapped to code + tests)                                                                   |
| Audit logging              | structured logs with correlation ids; append-only safety/AI records by contract                                                                        |
| Encryption                 | TLS everywhere (RDS force_ssl, Redis transit+at-rest, S3 SSE, ALB TLS 1.3 policy)                                                                      |
| Upload security            | pre-signed PUT with key policy, size/type bound, private bucket, TLS-only policy                                                                       |
| Dependency scanning        | `pnpm audit --audit-level=high` + TruffleHog verified-secret scan in CI                                                                                |
| Sensitive-log restrictions | pino redaction paths; readiness details reduced to error codes                                                                                         |
| Network                    | private subnets, SG-to-SG rules only, CloudFront→ALB shared-secret header                                                                              |
