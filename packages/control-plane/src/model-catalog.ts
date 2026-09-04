import type { TenantContext } from '@projectx/domain';
import type { TenantId } from '@projectx/shared';
import type { IModelCatalog, LLMModel, LLMModelQuery } from '@projectx/llm-gateway';
import type { IModelRepository } from './ports';
import type { Model } from './domain';

export class ControlPlaneModelCatalog implements IModelCatalog {
  constructor(private readonly repo: IModelRepository) {}

  async listEligibleModels(ctx: { tenantId: string }, _query: LLMModelQuery): Promise<readonly LLMModel[]> {
    const tenantCtx: TenantContext = {
      tenantId: ctx.tenantId as unknown as TenantId,
      correlationId: `model-catalog-${ctx.tenantId}`,
    };
    const models = await this.repo.listModels(tenantCtx);
    return models.map((m) => this.toLLMModel(m));
  }

  private toLLMModel(model: Model): LLMModel {
    const cost = (model.costMetadata ?? {}) as Record<string, unknown>;
    const health = (model.healthMetadata ?? {}) as Record<string, unknown>;

    return {
      modelId: model.modelId,
      providerId: model.provider,
      family: model.family,
      capabilities: model.capabilities,
      maxContextTokens: Number(health.maxContextTokens ?? 128_000),
      costPerInputTokenUsd: Number(cost.costPerInputTokenUsd ?? 0),
      costPerOutputTokenUsd: Number(cost.costPerOutputTokenUsd ?? 0),
      supportsStructuredOutput: health.supportsStructuredOutput !== false,
      latencyClass: (model.latencyClass as 'interactive' | 'background' | 'batch') || 'background',
      lifecycle: (health.lifecycle as 'ACTIVE' | 'DEPRECATED' | 'RETIRED' | 'DRAFT' | 'TESTING') || 'ACTIVE',
      priority: Number(health.priority ?? 0),
    };
  }
}
