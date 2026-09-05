import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { InMemoryAiAuditSink, aiInvocationRecordSchema } from './audit';
import { AiGatewayUnavailableError, NotConfiguredAiGateway } from './gateway';
import { InMemoryPromptRegistry, PromptNotFoundError } from './prompt-registry';
import { AiNotConfiguredError, ConfigModelRouter } from './provider';
import { defineAiTask } from './task';

const echoTask = defineAiTask({
  taskId: 'test.echo',
  description: 'Echoes input length',
  inputSchema: z.object({ text: z.string() }),
  outputSchema: z.object({ length: z.number().int() }),
  promptId: 'test.echo',
  budget: { timeoutMs: 1000, maxRetries: 1, maxTotalTokens: 100 },
  riskTier: 'LOW',
  fallback: { kind: 'DETERMINISTIC', compute: (i) => ({ length: i.text.length }) },
});

describe('defineAiTask', () => {
  it('rejects malformed ids and non-positive budgets', () => {
    expect(() => defineAiTask({ ...echoTask, taskId: 'Echo' })).toThrow(/taskId/);
    expect(() =>
      defineAiTask({ ...echoTask, budget: { ...echoTask.budget, timeoutMs: 0 } }),
    ).toThrow(/budget/);
  });
});

describe('NotConfiguredAiGateway (Phase 00 default) applies fallback policies deterministically', () => {
  const gw = new NotConfiguredAiGateway();

  it('DETERMINISTIC fallback computes the output and marks the source', async () => {
    const r = await gw.invoke(echoTask, { text: 'hello' }, { correlationId: 'c' });
    expect(r).toEqual({
      output: { length: 5 },
      source: 'FALLBACK',
      invocationId: 'not-configured',
    });
  });

  it('validates input before falling back', async () => {
    // @ts-expect-error — intentionally invalid
    await expect(gw.invoke(echoTask, { text: 5 }, { correlationId: 'c' })).rejects.toThrow();
  });

  it('FAIL_CLOSED tasks throw a typed, non-silent error', async () => {
    const closed = defineAiTask({
      ...echoTask,
      taskId: 'test.closed',
      fallback: { kind: 'FAIL_CLOSED', reason: 'safety decisions need a configured reviewer' },
    });
    await expect(gw.invoke(closed, { text: 'x' }, { correlationId: 'c' })).rejects.toBeInstanceOf(
      AiGatewayUnavailableError,
    );
  });

  it('DEGRADE tasks return the declared degraded value, validated against the output schema', async () => {
    const degrade = defineAiTask({
      ...echoTask,
      taskId: 'test.degrade',
      fallback: { kind: 'DEGRADE', value: { length: -1 } },
    });
    const r = await gw.invoke(degrade, { text: 'x' }, { correlationId: 'c' });
    expect(r.source).toBe('FALLBACK');
    expect(r.output).toEqual({ length: -1 });
  });
});

describe('InMemoryPromptRegistry', () => {
  it('versions are immutable and the latest ACTIVE one resolves by default', () => {
    const reg = new InMemoryPromptRegistry();
    reg.register({
      promptId: 'quest.generate',
      version: 1,
      template: 'Make a quest about {{topic}}',
      variables: ['topic'],
    });
    reg.register({
      promptId: 'quest.generate',
      version: 2,
      template: 'v2 {{topic}}',
      variables: ['topic'],
      status: 'DRAFT',
    });
    expect(reg.resolve('quest.generate').version).toBe(1);
    expect(reg.resolve('quest.generate', 2).version).toBe(2);
    expect(() => reg.register({ promptId: 'quest.generate', version: 1, template: 'dup' })).toThrow(
      /immutable/,
    );
    expect(() => reg.resolve('nope')).toThrow(PromptNotFoundError);
  });

  it('render substitutes variables and refuses missing ones', () => {
    const reg = new InMemoryPromptRegistry();
    reg.register({ promptId: 'p', version: 1, template: 'Hi {{ name }}!', variables: ['name'] });
    const p = reg.resolve('p');
    expect(reg.render(p, { name: 'Ragad' })).toBe('Hi Ragad!');
    expect(() => reg.render(p, {})).toThrow(/missing variables: name/);
  });
});

describe('ConfigModelRouter', () => {
  it('routes by task with a wildcard default and no hardcoded model in code', () => {
    const router = new ConfigModelRouter({
      '*': { providerId: 'anthropic', modelId: 'from-config', fallbacks: [], maxOutputTokens: 512 },
      'quest.safety.classify': {
        providerId: 'anthropic',
        modelId: 'strict-from-config',
        fallbacks: [{ providerId: 'other', modelId: 'x' }],
        maxOutputTokens: 256,
      },
    });
    expect(router.route('quest.generate').modelId).toBe('from-config');
    expect(router.route('quest.safety.classify').fallbacks).toHaveLength(1);
    expect(() => new ConfigModelRouter({}).route('anything')).toThrow(AiNotConfiguredError);
  });
});

describe('audit record', () => {
  it('requires a prompt hash rather than raw prompt text and records outcome/attempts', async () => {
    const sink = new InMemoryAiAuditSink();
    const record = {
      invocationId: '018f3f2e-9c1e-7c8a-b4a5-0f1e2d3c4b5a',
      taskId: 'quest.generate',
      promptId: 'quest.generate',
      promptVersion: 1,
      promptHash: `sha256:${'a'.repeat(64)}`,
      providerId: 'anthropic',
      modelId: 'cfg',
      correlationId: 'c',
      startedAt: '2026-09-04T00:00:00.000Z',
      latencyMs: 120,
      usage: { inputTokens: 10, outputTokens: 5, estimatedCostMicroUsd: 3 },
      outcome: 'SUCCESS' as const,
      attempts: 1,
      decisionBearing: false,
    };
    await sink.record(record);
    expect(sink.records).toHaveLength(1);
    expect(
      aiInvocationRecordSchema.safeParse({ ...record, promptHash: 'the raw prompt' }).success,
    ).toBe(false);
    expect(aiInvocationRecordSchema.safeParse({ ...record, outcome: 'MAYBE' }).success).toBe(false);
  });
});
