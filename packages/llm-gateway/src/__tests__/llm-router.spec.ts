import { LLMRouter } from '../llm-router';
import { ProviderRegistry } from '../provider-registry';
import type { ILLMProvider, LLMProviderRequest, LLMProviderResult } from '../llm-provider.interface';
import { LLMProviderError } from '../llm-provider.interface';
import type { IModelCatalog, LLMModel, LLMModelQuery } from '../llm-router';

class FakeCatalog implements IModelCatalog {
  constructor(private readonly models: readonly LLMModel[]) {}

  async listEligibleModels(_ctx: { tenantId: string }, _request: LLMModelQuery): Promise<readonly LLMModel[]> {
    return this.models;
  }
}

class FakeProvider implements ILLMProvider {
  readonly capabilities = ['chat', 'structured_output'] as const;
  public ready = true;
  public failWith?: { code: string; retryable: boolean; message: string };

  constructor(public readonly providerId: string, private readonly modelId: string) {}

  async checkReadiness(): Promise<void> {
    if (!this.ready) {
      throw new LLMProviderError(
        `${this.providerId} not ready`,
        this.providerId,
        'MISSING_SECRET',
        false,
      );
    }
  }

  async invoke(request: LLMProviderRequest): Promise<LLMProviderResult> {
    if (this.failWith) {
      throw new LLMProviderError(this.failWith.message, this.providerId, this.failWith.code, this.failWith.retryable);
    }
    return {
      providerId: this.providerId,
      modelId: request.modelId ?? this.modelId,
      providerRequestId: 'req-1',
      content: '{"ok":true}',
      structured: { ok: true },
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
      costUsd: request.costPerOutputTokenUsd ? request.costPerOutputTokenUsd * 5 : 0,
      latencyMs: 50,
      finishReason: 'stop',
      startedAt: new Date(),
      completedAt: new Date(),
    };
  }
}

const openaiModel: LLMModel = {
  modelId: 'gpt-4o-mini',
  providerId: 'openai',
  family: 'gpt',
  capabilities: ['chat'],
  maxContextTokens: 128000,
  costPerInputTokenUsd: 0.0000005,
  costPerOutputTokenUsd: 0.0000015,
  supportsStructuredOutput: true,
  latencyClass: 'background',
  lifecycle: 'ACTIVE',
  priority: 1,
};

const anthropicModel: LLMModel = {
  modelId: 'claude-3-haiku-20240307',
  providerId: 'anthropic',
  family: 'claude',
  capabilities: ['chat'],
  maxContextTokens: 200000,
  costPerInputTokenUsd: 0.0000008,
  costPerOutputTokenUsd: 0.0000025,
  supportsStructuredOutput: true,
  latencyClass: 'background',
  lifecycle: 'ACTIVE',
  priority: 2,
};

const baseRequest: LLMProviderRequest = {
  tenantId: 'tenant-1',
  missionId: 'mission-1',
  executionId: 'exec-1',
  agentId: 'agent-1',
  agentVersion: '1.0.0',
  capability: 'chat',
  messages: [{ role: 'user', content: 'hello' }],
  maxTokens: 100,
  correlationId: 'corr-1',
};

describe('LLMRouter', () => {
  it('selects the primary provider and returns its result', async () => {
    const registry = new ProviderRegistry();
    const openai = new FakeProvider('openai', 'gpt-4o-mini');
    registry.register(openai);

    const router = new LLMRouter(new FakeCatalog([openaiModel]), registry);
    const result = await router.invoke(baseRequest);

    expect(result.providerId).toBe('openai');
    expect(result.modelId).toBe('gpt-4o-mini');
  });

  it('falls back to anthropic when openai fails with a retryable error', async () => {
    const registry = new ProviderRegistry();
    const openai = new FakeProvider('openai', 'gpt-4o-mini');
    openai.failWith = { code: 'RATE_LIMIT', retryable: true, message: 'rate limited' };
    const anthropic = new FakeProvider('anthropic', 'claude-3-haiku-20240307');
    registry.register(openai);
    registry.register(anthropic);

    const router = new LLMRouter(new FakeCatalog([openaiModel, anthropicModel]), registry);
    const result = await router.invoke(baseRequest);

    expect(result.providerId).toBe('anthropic');
    expect(result.modelId).toBe('claude-3-haiku-20240307');
  });

  it('emits usage events', async () => {
    const registry = new ProviderRegistry();
    const openai = new FakeProvider('openai', 'gpt-4o-mini');
    registry.register(openai);

    const events: any[] = [];
    const router = new LLMRouter(new FakeCatalog([openaiModel]), registry, async (e) => events.push(e));
    await router.invoke(baseRequest);

    expect(events).toHaveLength(1);
    expect(events[0].providerId).toBe('openai');
    expect(events[0].correlationId).toBe('corr-1');
  });

  it('throws NoEligibleModelError when no models match', async () => {
    const router = new LLMRouter(new FakeCatalog([]), new ProviderRegistry());

    await expect(router.invoke(baseRequest)).rejects.toMatchObject({
      name: 'NoEligibleModelError',
    });
  });

  it('throws non-retryable error when provider is not ready (fail-closed)', async () => {
    const registry = new ProviderRegistry();
    const openai = new FakeProvider('openai', 'gpt-4o-mini');
    openai.ready = false;
    registry.register(openai);

    const router = new LLMRouter(new FakeCatalog([openaiModel]), registry);

    await expect(router.invoke(baseRequest)).rejects.toMatchObject({
      providerId: 'openai',
      code: 'MISSING_SECRET',
      retryable: false,
    });
  });

  it('throws AmbiguousRoutingError when two models tie on priority/cost/latency', async () => {
    const tiedModel: LLMModel = {
      ...anthropicModel,
      modelId: 'claude-tied',
      providerId: 'anthropic',
      priority: 1,
      costPerInputTokenUsd: openaiModel.costPerInputTokenUsd,
      costPerOutputTokenUsd: openaiModel.costPerOutputTokenUsd,
      latencyClass: openaiModel.latencyClass,
    };
    const registry = new ProviderRegistry();
    registry.register(new FakeProvider('openai', 'gpt-4o-mini'));
    registry.register(new FakeProvider('anthropic', 'claude-tied'));

    const router = new LLMRouter(new FakeCatalog([openaiModel, tiedModel]), registry);

    await expect(router.invoke(baseRequest)).rejects.toMatchObject({
      name: 'AmbiguousRoutingError',
    });
  });

  it('filters out models that exceed the budget', async () => {
    const expensiveModel: LLMModel = {
      ...openaiModel,
      modelId: 'gpt-expensive',
      costPerOutputTokenUsd: 10,
      priority: 1,
    };
    const cheapModel: LLMModel = {
      ...anthropicModel,
      modelId: 'claude-cheap',
      priority: 2,
    };

    const registry = new ProviderRegistry();
    registry.register(new FakeProvider('openai', 'gpt-expensive'));
    registry.register(new FakeProvider('anthropic', 'claude-cheap'));

    const router = new LLMRouter(new FakeCatalog([expensiveModel, cheapModel]), registry);
    const result = await router.invoke({ ...baseRequest, budget: { maxCostUsd: 0.001, maxTokens: 100 } });

    expect(result.providerId).toBe('anthropic');
    expect(result.modelId).toBe('claude-cheap');
  });

  it('filters out models that do not support structured output when required', async () => {
    const noJsonModel: LLMModel = { ...openaiModel, supportsStructuredOutput: false };
    const registry = new ProviderRegistry();
    registry.register(new FakeProvider('openai', 'gpt-4o-mini'));

    const router = new LLMRouter(new FakeCatalog([noJsonModel]), registry);

    await expect(
      router.invoke({
        ...baseRequest,
        structuredOutputSchema: { type: 'object' },
      }),
    ).rejects.toMatchObject({ name: 'NoEligibleModelError' });
  });

  it('throws when all providers fail', async () => {
    const registry = new ProviderRegistry();
    const openai = new FakeProvider('openai', 'gpt-4o-mini');
    openai.failWith = { code: 'PROVIDER_ERROR', retryable: true, message: 'down' };
    const anthropic = new FakeProvider('anthropic', 'claude-3-haiku-20240307');
    anthropic.failWith = { code: 'OVERLOADED', retryable: true, message: 'down' };
    registry.register(openai);
    registry.register(anthropic);

    const router = new LLMRouter(new FakeCatalog([openaiModel, anthropicModel]), registry);

    await expect(router.invoke(baseRequest)).rejects.toMatchObject({
      providerId: 'router',
      code: 'ALL_PROVIDERS_FAILED',
    });
  });
});
