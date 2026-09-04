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
          tenant_id, mission_id, execution_id, llm_call_id, attempt,
          provider_id, model_id, provider_request_id, capability,
          status, submitted, usage_known, failure_classification, retryable,
          input_tokens, output_tokens, total_tokens, cost_usd, estimated_cost_usd,
          latency_ms, started_at, completed_at,
          correlation_id, idempotency_key, recorded_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
          $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25
        )`,
        [
          record.tenantId,
          record.missionId,
          record.executionId,
          record.llmCallId,
          record.attempt,
          record.providerId,
          record.modelId,
          record.providerRequestId ?? null,
          record.capability,
          record.status,
          record.submitted,
          record.usageKnown,
          record.failureClassification ?? null,
          record.retryable ?? null,
          record.inputTokens ?? null,
          record.outputTokens ?? null,
          record.totalTokens ?? null,
          record.costUsd ?? null,
          record.estimatedCostUsd ?? null,
          record.latencyMs ?? null,
          record.startedAt ?? null,
          record.completedAt ?? null,
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
    const num = (v: unknown): number | undefined => (v === null || v === undefined ? undefined : Number(v));
    const date = (v: unknown): Date | undefined => (v === null || v === undefined ? undefined : new Date(v as string));
    return {
      tenantId: row.tenant_id as unknown as TenantId,
      missionId: row.mission_id as string,
      executionId: row.execution_id as string,
      llmCallId: row.llm_call_id as string,
      attempt: Number(row.attempt),
      providerId: row.provider_id as string,
      modelId: row.model_id as string,
      providerRequestId: (row.provider_request_id as string) ?? undefined,
      capability: row.capability as string,
      status: row.status as LLMInvocationRecord['status'],
      submitted: Boolean(row.submitted),
      usageKnown: Boolean(row.usage_known),
      failureClassification: (row.failure_classification as string) ?? undefined,
      retryable: row.retryable === null || row.retryable === undefined ? undefined : Boolean(row.retryable),
      inputTokens: num(row.input_tokens),
      outputTokens: num(row.output_tokens),
      totalTokens: num(row.total_tokens),
      costUsd: num(row.cost_usd),
      estimatedCostUsd: num(row.estimated_cost_usd),
      latencyMs: num(row.latency_ms),
      startedAt: date(row.started_at),
      completedAt: date(row.completed_at),
      correlationId: row.correlation_id as string,
      idempotencyKey: (row.idempotency_key as string) ?? undefined,
      recordedAt: new Date(row.recorded_at as string),
    };
  }
}
