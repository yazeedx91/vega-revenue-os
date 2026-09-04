import type { TenantId } from '@projectx/shared';
import type { TenantContext } from '@projectx/domain';
import { PostgresClient } from '@projectx/infrastructure';
import type { IReasoningArtifactRepository, ReasoningArtifact } from './reasoning-artifact.interface';

export class PostgresReasoningArtifactRepository implements IReasoningArtifactRepository {
  constructor(private readonly client: PostgresClient) {}

  async save(ctx: TenantContext, artifact: ReasoningArtifact): Promise<void> {
    await this.client.withTenant(ctx, async (client) => {
      await client.query(
        `INSERT INTO ai_runtime.reasoning_artifacts (
          tenant_id, mission_id, execution_id, agent_id, agent_version, capability,
          correlation_id, idempotency_key, rationale, conclusion, confidence, evidence,
          required_approvals, proposed_actions, assumptions, model_usage,
          provider_id, model_id, provider_request_id, latency_ms, recorded_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21
        )`,
        [
          artifact.tenantId,
          artifact.missionId,
          artifact.executionId,
          artifact.agentId,
          artifact.agentVersion ?? null,
          artifact.capability ?? null,
          artifact.correlationId,
          artifact.idempotencyKey ?? null,
          artifact.rationale,
          artifact.conclusion,
          artifact.confidence,
          JSON.stringify(artifact.evidence),
          artifact.requiredApprovals ? JSON.stringify(artifact.requiredApprovals) : null,
          artifact.proposedActions ? JSON.stringify(artifact.proposedActions) : null,
          artifact.assumptions ? JSON.stringify(artifact.assumptions) : null,
          JSON.stringify(artifact.modelUsage),
          artifact.providerId,
          artifact.modelId,
          artifact.providerRequestId,
          artifact.latencyMs,
          artifact.recordedAt,
        ],
      );
    });
  }

  async listByExecution(ctx: TenantContext, executionId: string): Promise<readonly ReasoningArtifact[]> {
    return this.client.withTenant(ctx, async (client) => {
      const result = await client.query(
        `SELECT * FROM ai_runtime.reasoning_artifacts
         WHERE execution_id = $1
         ORDER BY recorded_at ASC`,
        [executionId],
      );
      return result.rows.map((row) => this.mapRow(row));
    });
  }

  private mapRow(row: Record<string, unknown>): ReasoningArtifact {
    return {
      tenantId: row.tenant_id as unknown as TenantId,
      missionId: row.mission_id as string,
      executionId: row.execution_id as string,
      agentId: row.agent_id as string,
      agentVersion: (row.agent_version as string) ?? undefined,
      capability: (row.capability as string) ?? undefined,
      correlationId: row.correlation_id as string,
      idempotencyKey: (row.idempotency_key as string) ?? undefined,
      rationale: row.rationale as string,
      conclusion: row.conclusion as string,
      confidence: Number(row.confidence),
      evidence: (row.evidence as unknown as readonly string[]) ?? [],
      requiredApprovals: (row.required_approvals as unknown as readonly string[]) ?? undefined,
      proposedActions: (row.proposed_actions as unknown as readonly import('./reasoning.interface').ProposedAction[]) ?? undefined,
      assumptions: (row.assumptions as unknown as readonly string[]) ?? undefined,
      modelUsage: (row.model_usage as Record<string, unknown>) as any,
      providerId: row.provider_id as string,
      modelId: row.model_id as string,
      providerRequestId: row.provider_request_id as string,
      latencyMs: Number(row.latency_ms),
      recordedAt: new Date(row.recorded_at as string),
    };
  }
}
