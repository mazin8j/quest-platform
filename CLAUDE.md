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
- Mobile: React Native + Expo + TypeScript
- Web/Admin: Next.js + React + TypeScript
- Backend: NestJS + TypeScript
- Primary DB: PostgreSQL
- Geospatial: PostGIS
- Vector retrieval: pgvector
- Cache / hot counters: Redis
- Object storage: S3-compatible storage
- Cloud target: AWS
- Messaging: EventBridge + SQS initially
- IaC: Terraform
- CI/CD: GitHub Actions
- Containers: Docker
- Observability: OpenTelemetry + CloudWatch-compatible backend
- AI: provider-independent AI Gateway; Claude is the initial strategic LLM provider

## Repository Shape
- apps/mobile
- apps/web
- apps/admin
- apps/api
- packages/ui
- packages/types
- packages/config
- packages/events
- packages/ai
- packages/analytics
- infrastructure/terraform
- docs/product
- docs/architecture
- docs/api
- docs/data
- docs/ai
- docs/security
- docs/safety
- docs/ux
- docs/adr
- tests

## Core Bounded Contexts
Identity, Profiles, Quest, Participation, Proof, Quest Passport, Social Graph, Crews, Feed, Discovery, Gamification, Notifications, Location, Creators, Brands, World Quest, Trust & Safety, Moderation, Analytics, AI Intelligence.

## Non-Negotiable Architecture Rules
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

## Quality Gate Before Implementation
For every feature, identify and record:
- requirement and user value
- acceptance criteria
- architecture impact
- data/schema impact
- API/event impact
- security impact
- privacy impact
- trust & safety impact
- abuse/fraud considerations
- observability requirements
- test plan
- rollout/rollback plan

If any high-risk impact is unresolved, stop implementation and produce a decision proposal rather than silently choosing.

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
- ARCHITECTURE_DECISIONS.md — index of ADRs

At the beginning of a new session, read these files plus relevant ADRs before making structural changes.

## Agent Delegation
Use project subagents for bounded specialist work that would otherwise flood the primary context. The chief architect owns cross-domain consistency. Security and trust-safety agents must review high-risk features. QA reviews completion claims. DevOps owns deployability and rollback.

## Development Behavior
Prefer small, reviewable increments. Work phase-by-phase. Do not implement later phases merely because they are described in documentation. When a phase command is invoked, complete its required outputs and gates before declaring it complete.
