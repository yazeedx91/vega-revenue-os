import { LLMProviderError } from './llm-provider.interface';
import type {
  LLMProviderRequest,
  LLMProviderResult,
  ILLMProvider,
} from './llm-provider.interface';
import type { IProviderRegistry } from './provider-registry';

export interface LLMModel {
  readonly modelId: string;
  readonly providerId: string;
  readonly family?: string;
  readonly capabilities: readonly string[];
  readonly maxContextTokens: number;
  readonly costPerInputTokenUsd: number;
  readonly costPerOutputTokenUsd: number;
  readonly supportsStructuredOutput: boolean;
  readonly latencyClass: 'interactive' | 'background' | 'batch' | string;
  readonly lifecycle: 'ACTIVE' | 'DEPRECATED' | 'RETIRED' | 'DRAFT' | 'TESTING';
  readonly priority: number;
}

export interface IModelCatalog {
  listEligibleModels(ctx: { tenantId: string }, request: LLMModelQuery): Promise<readonly LLMModel[]>;
}

export interface LLMModelQuery {
  readonly capability: string;
  readonly maxTokens: number;
  readonly structuredOutputRequired: boolean;
  readonly budget?: { readonly maxCostUsd: number; readonly maxTokens: number };
  readonly latencyClass?: string;
  readonly modelFamily?: string;
  readonly modelId?: string;
}

export interface LLMUsageEvent {
  readonly tenantId: string;
  readonly missionId: string;
  readonly executionId: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly costUsd: number;
  readonly latencyMs: number;
  readonly correlationId: string;
  readonly idempotencyKey?: string;
}

export type LLMUsageListener = (event: LLMUsageEvent) => Promise<void> | void;

export class NoEligibleModelError extends Error {
  constructor(
    public readonly request: LLMProviderRequest,
    message: string,
  ) {
    super(message);
    this.name = 'NoEligibleModelError';
  }
}

export class AmbiguousRoutingError extends Error {
  constructor(
    public readonly request: LLMProviderRequest,
    public readonly tiedModels: readonly string[],
  ) {
    super(`Ambiguous LLM routing: cannot deterministically choose between ${tiedModels.join(', ')}`);
    this.name = 'AmbiguousRoutingError';
  }
}

export interface LLMRouterConfig {
  readonly defaultCapability?: string;
  readonly maxAttempts?: number;
}

export class LLMRouter {
  constructor(
    private readonly catalog: IModelCatalog,
    private readonly registry: IProviderRegistry,
    private readonly usageListener?: LLMUsageListener,
    private readonly config: LLMRouterConfig = {},
  ) {}

  async invoke(request: LLMProviderRequest): Promise<LLMProviderResult> {
    const query: LLMModelQuery = {
      capability: request.capability || this.config.defaultCapability || 'chat',
      maxTokens: request.maxTokens,
      structuredOutputRequired: request.structuredOutputSchema !== undefined,
      budget: request.budget,
      latencyClass: (request.metadata?.latencyClass as string | undefined) ?? 'background',
      modelFamily: request.modelFamily,
      modelId: request.modelId,
    };

    const candidates = await this.catalog.listEligibleModels({ tenantId: request.tenantId }, query);
    if (candidates.length === 0) {
      throw new NoEligibleModelError(request, `No eligible model for capability ${query.capability}`);
    }

    const ordered = this.rankCandidates(candidates, query, request);
    if (ordered.length === 0) {
      throw new NoEligibleModelError(request, `No eligible model after ranking for capability ${query.capability}`);
    }

    const maxAttempts = this.config.maxAttempts ?? ordered.length;
    const attempts = ordered.slice(0, maxAttempts);
    const errors: LLMProviderError[] = [];

    for (const model of attempts) {
      const provider = this.registry.get(model.providerId);
      if (!provider) {
        errors.push(
          new LLMProviderError(
            `Provider ${model.providerId} not registered`,
            model.providerId,
            'PROVIDER_NOT_REGISTERED',
            false,
          ),
        );
        continue;
      }

      await provider.checkReadiness();

      const providerRequest: LLMProviderRequest = {
        ...request,
        modelId: request.modelId ?? model.modelId,
        costPerInputTokenUsd: request.costPerInputTokenUsd ?? model.costPerInputTokenUsd,
        costPerOutputTokenUsd: request.costPerOutputTokenUsd ?? model.costPerOutputTokenUsd,
      };

      try {
        const result = await provider.invoke(providerRequest);
        await this.emitUsage(request, result);
        return result;
      } catch (err) {
        if (err instanceof LLMProviderError) {
          errors.push(err);
          if (!err.retryable) {
            throw err;
          }
          continue;
        }
        const unwrapped = err instanceof Error ? err : new Error(String(err));
        throw new LLMProviderError(unwrapped.message, 'router', 'ROUTER_UNEXPECTED_ERROR', false, unwrapped);
      }
    }

    const message = errors.map((e) => `${e.providerId}: ${e.message}`).join('; ');
    throw new LLMProviderError(
      `All providers failed for capability ${query.capability}: ${message}`,
      'router',
      'ALL_PROVIDERS_FAILED',
      errors.some((e) => e.retryable),
    );
  }

  private rankCandidates(
    models: readonly LLMModel[],
    query: LLMModelQuery,
    request: LLMProviderRequest,
  ): readonly LLMModel[] {
    const budget = query.budget;
    const active = models.filter((m) => {
      if (m.lifecycle !== 'ACTIVE') return false;
      if (m.maxContextTokens < query.maxTokens) return false;
      if (query.structuredOutputRequired && !m.supportsStructuredOutput) return false;
      if (budget) {
        const estimatedCost = m.costPerOutputTokenUsd > 0 ? m.costPerOutputTokenUsd * query.maxTokens : 0;
        if (estimatedCost > budget.maxCostUsd) return false;
        if (query.maxTokens > budget.maxTokens) return false;
      }
      if (query.modelFamily && m.family !== query.modelFamily) return false;
      if (query.modelId && m.modelId !== query.modelId) return false;
      return true;
    });

    if (active.length === 0) {
      return [];
    }

    const scored = active.map((m) => ({
      model: m,
      score: this.score(m, query),
    }));

    scored.sort((a, b) => {
      if (a.score.priority !== b.score.priority) return a.score.priority - b.score.priority;
      if (a.score.cost !== b.score.cost) return a.score.cost - b.score.cost;
      if (a.score.latency !== b.score.latency) return a.score.latency - b.score.latency;
      return a.model.modelId.localeCompare(b.model.modelId);
    });

    const first = scored[0];
    const tied = scored.filter(
      (s) =>
        s.score.priority === first.score.priority &&
        s.score.cost === first.score.cost &&
        s.score.latency === first.score.latency,
    );
    if (tied.length > 1) {
      throw new AmbiguousRoutingError(
        request,
        tied.map((s) => s.model.modelId),
      );
    }

    return scored.map((s) => s.model);
  }

  private score(model: LLMModel, query: LLMModelQuery): { priority: number; cost: number; latency: number } {
    const latencyRank = { interactive: 1, background: 2, batch: 3 }[model.latencyClass] ?? 9;
    const queryLatencyRank = { interactive: 1, background: 2, batch: 3 }[query.latencyClass ?? 'background'] ?? 9;

    const capabilityMatch = model.capabilities.includes(query.capability) ? 0 : 1000;
    const structuredMatch = !query.structuredOutputRequired || model.supportsStructuredOutput ? 0 : 1000;

    return {
      priority: model.priority + capabilityMatch + structuredMatch,
      cost: model.costPerOutputTokenUsd,
      latency: Math.abs(latencyRank - queryLatencyRank),
    };
  }

  private async emitUsage(request: LLMProviderRequest, result: LLMProviderResult): Promise<void> {
    if (!this.usageListener) return;
    await this.usageListener({
      tenantId: request.tenantId,
      missionId: request.missionId,
      executionId: request.executionId,
      providerId: result.providerId,
      modelId: result.modelId,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      totalTokens: result.totalTokens,
      costUsd: result.costUsd,
      latencyMs: result.latencyMs,
      correlationId: request.correlationId,
      idempotencyKey: request.idempotencyKey,
    });
  }
}
