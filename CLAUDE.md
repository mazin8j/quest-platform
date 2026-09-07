# QUEST — Claude Project Constitution

## Mission

QUEST is an AI-native global social participation network. Traditional social networks optimize for viewing and scrolling. QUEST optimizes for real-world participation, achievement, collaboration, discovery, and positive community impact.

Core loop:
DISCOVER → ACCEPT → DO → PROVE → ACHIEVE → SHARE → CHALLENGE → REPEAT

North-star principle: optimize for meaningful completed actions, not passive attention.

## Product Principles

- Mobile-first and global-first.
- AI-native, but never AI-dependent for basic product operation.
- Safety-by-design, privacy-by-design, and security-by-design.
- Real-world action is the product; content is the evidence and social layer around action.
- Unknown creators must have a path to distribution based on Quest quality, not follower count alone.
- Build for multilingual, multi-cultural operation from the data model onward.
- Protect minors, precise location data, and identity-linked evidence with elevated controls.
- Never encourage dangerous, illegal, humiliating, exploitative, self-harm-related, sexual, or reckless challenges.

## Initial Technical Strategy

Use a production-grade modular monolith with explicit domain boundaries and event-driven integration. Do not create microservices unless a written ADR demonstrates a scaling, isolation, compliance, ownership, or availability reason.

### Stack

- Mobile: React Native + Expo (expo-router) + TypeScript
- Web/Admin: Next.js + React + TypeScript
- Backend: NestJS + TypeScript (zod contract-first validation)
- Primary DB: PostgreSQL 16 (Drizzle ORM, hand-authored SQL migrations — ADR-010)
- Geospatial: PostGIS
- Vector retrieval: pgvector
- Cache / hot counters: Redis
- Object storage: S3-compatible storage
- Cloud target: AWS
- Messaging: EventBridge + SQS initially (in-process bus locally)
- IaC: Terraform
- CI/CD: GitHub Actions (`.github/workflows/ci.yml`)
- Workspace: pnpm 10 + Turborepo, TypeScript 5.9, ESLint 9, Prettier, Vitest, dependency-cruiser (ADR-009)
- Containers: Docker
- Observability: OpenTelemetry + CloudWatch-compatible backend
- AI: provider-independent AI Gateway; Claude is the initial strategic LLM provider

## Repository Shape (actual — keep in sync with the tree)

- `apps/api` — NestJS modular monolith (domain modules under `src/modules/<context>/`)
- `apps/mobile` — React Native + Expo (expo-router)
- `apps/web` — Next.js public/creator web
- `apps/admin` — Next.js admin/moderation console
- `packages/types` — cross-application contracts (API envelope, pagination, safety contract, health, identity/profile contracts, RBAC vocabulary, age policy)
- `packages/config` — validated environment primitives
- `packages/events` — domain event envelope, ports, in-process bus
- `packages/ai` — provider-independent AI Gateway contracts
- `packages/ui` — design tokens
- `packages/analytics` — analytics event contract and sinks
- `packages/api-client` — shared HTTP client for mobile/web/admin
- `infrastructure/docker` — local PostgreSQL (PostGIS + pgvector) image
- `infrastructure/terraform` — AWS modules + `environments/<env>`
- `docs/architecture` (01–13 + DEPENDENCY_RULES), `docs/api` (conventions, identity guide, generated `openapi/v1.json`), `docs/data`, `docs/ai`, `docs/security` (security, privacy, safety baseline, identity threat model + classification), `docs/adr`, `docs/governance`, `docs/roadmap`, `docs/product`, `docs/DEVELOPER_SETUP.md`
- `docs/ux` — UX flows (first deliverable: Phase 01 mobile onboarding); cross-layer E2E suites live in `apps/api/test/e2e` (client SDK ↔ live API ↔ database) until a multi-app runner is needed under `tests/`; unit/integration tests live next to each workspace
- `.claude/agents`, `.claude/skills` — Claude development pack
- Root: `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `eslint.config.mjs`, `.dependency-cruiser.cjs`, `docker-compose.yml`, `.github/workflows/ci.yml`

## Core Bounded Contexts

Identity, Profiles, Quest, Participation, Proof, Quest Passport, Social Graph, Crews, Feed, Discovery, Gamification, Notifications, Location, Creators, Brands, World Quest, Trust & Safety, Moderation, Analytics, AI Intelligence.

## Non-Negotiable Architecture Rules

Mechanically enforced where possible: `docs/architecture/DEPENDENCY_RULES.md` (`pnpm deps:check`) and ESLint. Standard commands: `pnpm verify`, `pnpm infra:up`, `pnpm db:migrate`, `pnpm db:migrate:status`, `pnpm --filter @quest/api openapi:generate` — see `docs/DEVELOPER_SETUP.md`. Every HTTP route is authenticated unless marked `@Public`; identity keys are immutable UUIDs (ADR-011).

1. Read relevant files before editing. Never guess existing code.
2. Every major technology choice requires an ADR.
3. APIs are versioned and contract-first.
4. All external integrations sit behind an adapter/interface.
5. AI providers are never called directly from feature modules; route through packages/ai and the AI Gateway.
6. Every AI output used for ranking, safety, proof, or user-facing decisions is traceable with prompt/version/model metadata where legally appropriate.
7. User media uploads use direct-to-object-storage patterns; do not proxy large videos through the API service.
8. Location access is least-privilege and purpose-bound. Store precise location only when needed.
9. Asynchronous work uses domain events; do not make user requests wait for analytics, notifications, transcoding, or noncritical AI work.
10. PostgreSQL is the default system of record until an ADR proves another datastore is needed.
11. Redis is not a system of record.
12. Every background job is idempotent and retry-safe.
13. No hard-coded secrets, model IDs, cloud account IDs, URLs, or environment-specific configuration.
14. Every feature includes telemetry, failure modes, and rollback considerations.
15. Feature flags gate risky or experimental capabilities.

## Quality Gates

The canonical gate ladder (G0 Requirement → G1 Architecture → G2 Security/Privacy/Safety → G3 Implementation → G4 Verification → G5 Release) is defined in `docs/governance/QUALITY_GATES.md`. Every feature records the G0–G2 inputs (requirement/value, acceptance criteria, architecture/data/API/event/security/privacy/trust-safety/abuse impact, observability, test plan, rollout/rollback) before implementation. If any high-risk impact is unresolved, stop and produce a decision proposal rather than silently choosing. Phase transitions additionally require the independent phase-gate audit (`docs/governance/PHASE_GATE_AUDIT_*.md`).

## Testing Standard

At minimum, use the appropriate combination of unit, integration, API contract, component, end-to-end, security, migration, and load tests. Critical flows require automated E2E coverage: sign-up, Quest creation, Quest acceptance, proof submission, safety intervention, reward issuance, and account/reporting controls.

Never modify tests only to make broken behavior pass. Fix root cause or document an approved specification change.

## Definition of Done

A change is Done only when:

- acceptance criteria pass
- relevant tests pass
- types/lint/build pass
- security and safety checks are addressed
- migrations are reversible or have a documented rollback
- telemetry exists
- documentation is updated
- no secrets or debug artifacts are committed
- API/event changes are versioned or backward compatible
- PROGRESS.md and BACKLOG.md are updated when scope/status changes

## Persistent Working Files

Always maintain:

- PROGRESS.md — current phase, finished work, blockers, next actions
- BACKLOG.md — prioritized product/technical backlog
- ARCHITECTURE_DECISIONS.md — index of ADRs (an ADR is Accepted only when its file exists under `docs/adr/`)

At the beginning of a new session, read these files plus relevant ADRs before making structural changes.

## Agent Delegation

Use project subagents for bounded specialist work that would otherwise flood the primary context. The chief architect owns cross-domain consistency. Security and trust-safety agents must review high-risk features. QA reviews completion claims. DevOps owns deployability and rollback.

## Development Behavior

Prefer small, reviewable increments. Work phase-by-phase. Do not implement later phases merely because they are described in documentation. When a phase command is invoked, complete its required outputs and gates before declaring it complete.
