---
name: ai-gateway
description: Use for any feature that calls Claude or another AI model, including generation, ranking assistance, moderation assistance, proof analysis, or copilots.
---

# ai-gateway

## Use when

Use for any feature that calls Claude or another AI model, including generation, ranking assistance, moderation assistance, proof analysis, or copilots.

## Inputs

The feature's task purpose, input/output fields, risk tier, latency/cost budget; existing task definitions in `packages/ai`; `docs/architecture/08_AI_ARCHITECTURE.md`; ADR-004.

## Workflow

1. Define the task with `defineAiTask` (zod input/output schemas, budget, riskTier, fallback policy).
2. Register the prompt version in the registry; never inline prompt text in feature code.
3. Add a configuration route for the task (provider/model from config, fallbacks).
4. Add eval fixtures and wire `AiEvaluationHook`; define redaction of inputs.
5. Call `AI_GATEWAY.invoke(...)` from the application service and handle `source: 'FALLBACK'`.

## Guidance

All model access routes through the AI Gateway. Define typed task interface, model policy, prompt/version, structured output, safety checks, timeouts, retries, caching rules, cost/latency budget, provider fallback, audit fields, redaction, evaluation cases and deterministic fallback. Do not embed provider model IDs across feature code.

## Constraints

No provider SDK outside `packages/ai/src/adapters`; no model ids in feature code; decision-bearing outputs feed a deterministic rule or human, never act alone; audit fields mandatory.

## Done when / Exit criteria

Task, prompt version, route config, eval cases, tests and audit fields exist; `pnpm lint && pnpm deps:check` pass; docs updated.
