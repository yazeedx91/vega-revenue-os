import type { TenantId } from '@projectx/shared';
import type { TenantContext } from '@projectx/domain';
import { PostgresClient } from '@projectx/infrastructure';
import type { IInvocationAccounting, LLMInvocationRecord } from './invocation-accounting.interface';

export class PostgresInvocationAccounting implements IInvocationAccounting {
  constructor(private readonly client: PostgresClient) {}

  async record(ctx: TenantContext, record: LLMInvocationRecord): Promise<void> {
    await this.client.withTenant(ctx, async (client) => {
      await client.query(
        `INSERT INTO ai_runtime.llm_invocations (
          tenant_id, mission_id, execution_id, provider_id, model_id, provider_request_id,
          capability, input_tokens, output_tokens, total_tokens, cost_usd, latency_ms,
          correlation_id, idempotency_key, recorded_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15
        )`,
        [
          record.tenantId,
          record.missionId,
          record.executionId,
          record.providerId,
          record.modelId,
          record.providerRequestId,
          record.capability,
          record.inputTokens,
          record.outputTokens,
          record.totalTokens,
          record.costUsd,
          record.latencyMs,
          record.correlationId,
          record.idempotencyKey ?? null,
          record.recordedAt,
        ],
      );
    });
  }

  async listByExecution(ctx: TenantContext, executionId: string): Promise<readonly LLMInvocationRecord[]> {
    return this.client.withTenant(ctx, async (client) => {
      const result = await client.query(
        `SELECT * FROM ai_runtime.llm_invocations
         WHERE execution_id = $1
         ORDER BY recorded_at ASC`,
        [executionId],
      );
      return result.rows.map((row) => this.mapRow(row));
    });
  }

  private mapRow(row: Record<string, unknown>): LLMInvocationRecord {
    return {
      tenantId: row.tenant_id as unknown as TenantId,
      missionId: row.mission_id as string,
      executionId: row.execution_id as string,
      providerId: row.provider_id as string,
      modelId: row.model_id as string,
      providerRequestId: row.provider_request_id as string,
      capability: row.capability as string,
      inputTokens: Number(row.input_tokens),
      outputTokens: Number(row.output_tokens),
      totalTokens: Number(row.total_tokens),
      costUsd: Number(row.cost_usd),
      latencyMs: Number(row.latency_ms),
      correlationId: row.correlation_id as string,
      idempotencyKey: (row.idempotency_key as string) ?? undefined,
      recordedAt: new Date(row.recorded_at as string),
    };
  }
}
