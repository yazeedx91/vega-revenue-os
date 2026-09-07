import type { TenantContext } from '@projectx/domain';
import { PostgresClient } from '@projectx/infrastructure';
import type { EmbeddingResult } from './embedding-provider.interface';

export interface EmbeddingInvocationRecord {
  readonly providerId: string;
  readonly embeddingProfileId: string;
  readonly vectorSpace: string;
  readonly modelId: string;
  readonly modelVersion: string;
  readonly dimensions: number;
  readonly vectorCount: number;
  readonly inputTokens?: number;
  readonly costUsd?: number;
  readonly latencyMs: number;
  readonly correlationId?: string;
  readonly idempotencyKey?: string;
  readonly recordedAt: Date;
}

/**
 * Records embedding invocations for accounting/audit. Reuses the existing
 * `ai_runtime.llm_invocations` ledger so embedding usage is accounted alongside
 * LLM usage with the same tenant isolation and correlation metadata.
 */
export interface IEmbeddingAccounting {
  record(ctx: TenantContext, result: EmbeddingResult, meta?: { correlationId?: string; idempotencyKey?: string }): Promise<void>;
}

export class PostgresEmbeddingAccounting implements IEmbeddingAccounting {
  constructor(private readonly client: PostgresClient) {}

  async record(
    ctx: TenantContext,
    result: EmbeddingResult,
    meta?: { correlationId?: string; idempotencyKey?: string },
  ): Promise<void> {
    await this.client.withTenant(ctx, async (client) => {
      await client.query(
        `INSERT INTO embedding.invocations
          (invocation_id, tenant_id, provider_id, embedding_profile_id, vector_space,
           model_id, model_version, dimensions, vector_count, status,
           input_tokens, cost_usd, latency_ms, correlation_id, idempotency_key, recorded_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [
          `emb-${result.providerRequestId ?? `${result.startedAt.getTime()}`}`,
          ctx.tenantId,
          result.providerId,
          result.embeddingProfileId,
          result.vectorSpace,
          result.modelId,
          result.modelVersion,
          result.dimensions,
          result.vectors.length,
          'SUCCEEDED',
          result.inputTokens ?? null,
          result.costUsd ?? null,
          result.latencyMs,
          meta?.correlationId ?? null,
          meta?.idempotencyKey ?? null,
          result.completedAt,
        ],
      );
    });
  }
}
