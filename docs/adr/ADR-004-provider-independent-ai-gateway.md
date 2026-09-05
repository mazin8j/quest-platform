# ADR-004 — Provider-independent AI Gateway

## Status

Accepted (2026-09-04, Phase 00)

## Context

QUEST is AI-native (quest generation, safety classification, proof analysis, ranking) but must never be AI-dependent for basic operation. Provider pricing, capability and availability change; model identifiers must not leak into feature code (CLAUDE.md rules 5, 6, 13). Every AI output that influences safety, proof, ranking or user-facing decisions must be auditable.

## Decision

All model access goes through `packages/ai`: feature modules depend on the `AiGateway` port and typed `AiTaskDefinition`s (zod input/output schemas, budget, risk tier, mandatory fallback policy). The gateway owns prompt resolution (`PromptRegistry`, versioned, immutable), model routing (`ModelRouter`, configuration-driven), timeout/retry/fallback, structured-output validation, audit records (`AiInvocationRecord` with prompt hash, provider, model, tokens, cost, latency, outcome) and evaluation hooks. Provider SDKs may be imported only inside `packages/ai/src/adapters/*` — enforced by ESLint `no-restricted-imports` and dependency-cruiser. Phase 00 ships the contracts and a `NotConfiguredAiGateway` that applies fallback policies; Claude (Anthropic) is the first adapter in Phase 06.

## Alternatives Considered

- **Call the vendor SDK from feature modules** — rejected: lock-in, no audit, untestable, model IDs everywhere.
- **Third-party LLM gateway product** — deferred: adds a network hop and vendor; can later sit _behind_ the provider adapter without changing feature code.
- **LangChain-style agent framework** — rejected: unnecessary abstraction; QUEST needs typed tasks, not agents.

## Consequences

- Positive: swappable providers, reproducible decisions (promptId@version + hash), cost/latency budgets enforced centrally, deterministic fallbacks keep the product working without AI.
- Negative: some boilerplate per task; adapters must map provider-specific structured-output mechanisms.
- Safety: high-risk tasks default to `FAIL_CLOSED` or human review; AI never has the final word on publication (see `@quest/types` safety contract).

## Revisit Triggers

More than two providers in production, need for streaming responses, or an external gateway offering measurable cost/latency gains.
