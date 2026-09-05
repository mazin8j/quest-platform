# AI documentation

- Architecture: [`../architecture/08_AI_ARCHITECTURE.md`](../architecture/08_AI_ARCHITECTURE.md) · Decision: [`../adr/ADR-004-provider-independent-ai-gateway.md`](../adr/ADR-004-provider-independent-ai-gateway.md)
- Contracts (code): `packages/ai/src/` — `task.ts` (typed tasks + fallback policies), `gateway.ts`
  (application port), `provider.ts` (adapter + model routing), `prompt-registry.ts`, `audit.ts`
  (invocation record, sink, evaluation hook), `capabilities.ts` (`generateQuest`,
  `classifyQuestSafety`, `analyzeProof`, `rankRecommendations` shapes).

## Adding an AI task (Phase 06 onward)

1. `defineAiTask({ taskId: '<context>.<action>', inputSchema, outputSchema, promptId, budget, riskTier, fallback })` in the owning module.
2. Register `promptId@version` in the registry (immutable; bump the version to change wording).
3. Add a `ModelRoute` for the task in configuration (never a model id in code).
4. Add eval fixtures (input → expected output constraints) and wire `AiEvaluationHook`.
5. Feature code calls `AI_GATEWAY.invoke(task, input, { correlationId, actorId, decisionBearing })` and handles `source: 'FALLBACK'`.
6. For safety/proof/ranking decisions: the gateway output is _input_ to a deterministic rule or a human — never the final authority.
