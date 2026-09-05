# 08 — AI Architecture

```mermaid
flowchart LR
  FM[Feature module<br/>depends on AiGateway + AiTaskDefinition] --> GW[AI Gateway core<br/>packages/ai — Phase 06 implementation]
  GW --> PR[PromptRegistry<br/>promptId@version, immutable]
  GW --> MR[ModelRouter<br/>config-driven provider/model + fallbacks]
  GW --> POL[Budget & safety policy<br/>timeout · retries · token/cost caps · risk tier]
  GW --> AD[Provider adapters<br/>packages/ai/src/adapters/* — the ONLY place vendor SDKs exist]
  AD --> P1[Anthropic — Phase 06]
  AD --> P2[Other providers — later]
  GW --> OUT[Output validation<br/>zod outputSchema]
  GW --> AUD[AiAuditSink<br/>AiInvocationRecord: prompt hash, model, tokens, cost, latency, outcome]
  GW --> EVAL[AiEvaluationHook]
  GW --> FB[Fallback policy<br/>DETERMINISTIC · DEGRADE · FAIL_CLOSED]
```

Implemented in Phase 00 (`packages/ai`, 9 tests): `AiTaskDefinition`/`defineAiTask`, `AiGateway`
port, `NotConfiguredAiGateway` (applies fallbacks, no network), `PromptRegistry` +
`InMemoryPromptRegistry`, `AiProviderAdapter`/`ModelRouter`/`ConfigModelRouter`,
`AiInvocationRecord` + `InMemoryAiAuditSink`, `AiEvaluationHook`, capability contracts
`generateQuest`, `classifyQuestSafety`, `analyzeProof`, `rankRecommendations`.

Enforcement: ESLint `no-restricted-imports` and dependency-cruiser forbid provider SDKs outside
`packages/ai`; `AI_MODEL_DEFAULT` is configuration; `apps/api` `AiModule` refuses to boot with
`AI_PROVIDER≠none` until Phase 06 implements the adapter.

Safety principles: AI never has the final word on publication, rewards or sanctions; high-risk
tasks are `FAIL_CLOSED` or route to human review; prompts are hashed, not stored raw, unless a task
opts in with a retention policy; PII is minimised before prompts are rendered.
