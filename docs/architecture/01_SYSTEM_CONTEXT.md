# 01 — System Context

QUEST is a participation network: people discover, accept, do, prove, achieve and share real-world
Quests. The system boundary is the QUEST platform (mobile, web, admin, API, workers). Everything
outside is an external system reached through an adapter.

```mermaid
flowchart LR
  subgraph Actors
    U[Participant / Creator]
    M[Moderator / Support / Admin]
    B[Brand user — Phase 13]
  end
  subgraph QUEST platform
    MOB[apps/mobile]
    WEB[apps/web]
    ADM[apps/admin]
    API[apps/api — NestJS modular monolith]
  end
  subgraph External systems
    IDP[Identity providers — Phase 01]
    OBJ[(S3-compatible object storage)]
    AI[LLM providers via AI Gateway — Phase 06]
    MAP[Maps / geocoding — Phase 08]
    PUSH[Push / email — Phase 01+]
    OBS[Observability backend]
  end
  U --> MOB & WEB
  M --> ADM
  B -. later .-> WEB
  MOB & WEB & ADM -->|HTTPS /v1, correlation ids| API
  MOB & WEB -->|pre-signed PUT| OBJ
  API --> OBJ & IDP & AI & MAP & PUSH & OBS
```

Trust boundaries: (1) public internet → CloudFront/WAF → ALB → API; (2) API → data tier (private
subnets, TLS); (3) API → AI providers (only through `packages/ai`, redacted, budgeted); (4) client
devices are untrusted — every rule is enforced server-side; clients hold only short-lived tokens in
secure storage.

Phase 00 status: all four applications exist as runnable shells; the API serves `/health`,
`/ready`, `/v1/system/info`; no identity provider, AI provider, maps or push integration is wired yet.
