# QUEST Backlog

## P0 — MVP

- Identity and profile
- Interests and onboarding
- Quest create/publish/discover
- Accept/start/complete Quest
- Photo/video proof
- Safety classification
- XP, levels, badges
- Quest Passport
- Friends/follows
- Comments/reactions/shares
- Challenge friends
- Nearby quests
- World Quest v1
- Notifications
- Admin moderation
- AI Quest Generator
- Basic personalization

## P1 — Growth

- Crews
- Quest chains
- Mystery Quest
- City/country competitions
- Creator Quest tools
- Referral attribution
- Advanced recommendation/ranking
- Enhanced proof verification

## P2 — Monetization

- Sponsored Quests
- Brand campaigns
- Creator monetization
- Quest+ subscription
- Corporate Quest
- Tourism/destination Quest packages

## Technical debt & foundation follow-ups (from Phase 00, 2026-09-04)

### Must do in the phase that first needs it

- TD-01 Transactional outbox for domain events before the first cross-process consumer (Phase 05 at
  the latest); EventBridge publisher adapter + SQS consumer runtime (same image, worker entrypoint).
- TD-02 Redis-backed `@nestjs/throttler` storage before running > 1 API replica.
- TD-03 OpenAPI generation from zod schemas with the first resource endpoints (Phase 01).
- TD-04 OpenTelemetry NodeSDK preload (`OTEL_ENABLED=true`) + ADOT collector sidecar with the first
  deployed environment; `MetricsPort` implementation over the OTel meter.
- TD-05 Deploy workflow (build/push image to ECR, `terraform plan` on PR, gated `apply`) once an AWS
  account and remote-state bucket exist; assemble `DATABASE_URL`/`REDIS_URL` from outputs + RDS secret.
- TD-06 Component tests for mobile (jest-expo or RNTL) and web/admin with the first real screens.
- TD-07 Account export/deletion cascade design + `identity.account.deleted` handlers (Phase 01).
- TD-08 EXIF/location metadata policy for evidence before any media is stored (Phase 05).

### Should fix

- TD-17 **Audit risk acceptance (expires 2026-12-01)**: `image-size <=2.0.2` (GHSA-w3rx-r6r6-pgpr,
  GHSA-5p2g-fcmc-qvqq) ignored in `pnpm-workspace.yaml` `auditConfig.ignoreGhsas` — reached only via
  Expo/Metro dev tooling, no upstream patch. Re-evaluate at Expo SDK 58 or by the expiry date; remove
  the ignore as soon as a patched transitive version ships.
- TD-18 Web/admin CSP `connect-src` omits the API origin when `NEXT_PUBLIC_API_BASE_URL` is unset at
  build time (env module defaults to localhost:4000). Harmless while all API calls are server-side;
  align before the first client-side fetch.
- TD-19 Rate-limit envelope message carries the framework prefix (`ThrottlerException: …`); map to a
  contract message and assert `retry-after` in the rate-limit test.

- TD-09 Upgrade ESLint 9 → 10 when `eslint-config-next` supports it (blocked: `react/display-name`
  rule incompatible with ESLint 10 core API).
- TD-10 Add `docs/ux` with the first UX deliverable; add cross-application E2E suite under `tests/`
  when the first end-to-end flow (sign-up) exists.
- TD-11 Confirm `me-central-1` service availability for each newly adopted managed service; revisit
  ADR-008 triggers quarterly.
- TD-12 Add `terraform validate` results from the first CI run to `PROGRESS.md` (sandbox could not
  reach provider registries).
- TD-13 Consider `PriceClass_All` for CloudFront if MENA edge coverage under `PriceClass_200` proves
  insufficient (measure p95 from Amman/Riyadh/Dubai).

### Nice to have

- TD-14 Turborepo remote cache for CI speed.
- TD-15 Renovate/Dependabot configuration for grouped dependency updates with Expo SDK awareness.
- TD-16 `docs/architecture` diagrams exported as images for non-Mermaid viewers.
