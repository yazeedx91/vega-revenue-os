import type { Pool } from 'pg';
import type { TenantContext } from '@projectx/domain';
import type { ApprovalId, CorrelationId, IdempotencyKey, TenantId, UserId } from '@projectx/shared';
import { ConcurrencyConflictError, PostgresClient, toDate } from '@projectx/infrastructure';
import { Approval } from '../domain/approval/approval';
import type { ApprovalStatus } from '../domain/approval/approval-status';
import type { IApprovalRepository } from '../ports/approval-repository.interface';

export interface PostgresApprovalRepositoryConfig { pool: Pool }

type ApprovalSnapshot = {
  missionId: string; sequenceId?: string; taskId?: string; executionId?: string;
  actionType: string; riskCategory: string; proposedAction: unknown; evidence: unknown[];
  reasoning: string; confidence: number; requestedBy: string; approverRole: string;
  timeoutSeconds: number; idempotencyKey: string; correlationId: string; status: string;
  decidedBy?: string; decisionReason?: string; createdAt: Date; updatedAt: Date;
};

function snapshot(entity: Approval): ApprovalSnapshot {
  return {
    missionId: entity.missionId, sequenceId: entity.sequenceId, taskId: entity.taskId,
    executionId: entity.executionId, actionType: entity.actionType, riskCategory: entity.riskCategory,
    proposedAction: entity.proposedAction, evidence: entity.evidence, reasoning: entity.reasoning,
    confidence: entity.confidence, requestedBy: entity.requestedBy, approverRole: entity.approverRole,
    timeoutSeconds: entity.timeoutSeconds, idempotencyKey: entity.idempotencyKey as string,
    correlationId: entity.correlationId as string, status: entity.status, decidedBy: entity.decidedBy,
    decisionReason: entity.decisionReason, createdAt: entity.createdAt, updatedAt: entity.updatedAt,
  };
}

function restore(row: any): Approval {
  const value = row.payload as ApprovalSnapshot;
  return Approval.reconstitute({
    ...value,
    id: row.id as ApprovalId,
    tenantId: row.tenant_id as TenantId,
    workspaceId: row.workspace_id ?? undefined,
    workspaceBindingState: row.workspace_binding_state,
    missionId: row.mission_id,
    status: value.status as ApprovalStatus,
    idempotencyKey: value.idempotencyKey as IdempotencyKey,
    correlationId: value.correlationId as CorrelationId,
    decidedBy: value.decidedBy as UserId | undefined,
    createdAt: toDate(value.createdAt),
    updatedAt: toDate(value.updatedAt),
  }, row.version);
}

export class PostgresApprovalRepository implements IApprovalRepository {
  private readonly db: PostgresClient;
  constructor(config: PostgresApprovalRepositoryConfig) { this.db = new PostgresClient(config.pool); }

  async load(ctx: TenantContext, approvalId: string): Promise<Approval | null> {
    if (!ctx.workspaceId) return null;
    return this.db.withTenant(ctx, async (client) => {
      const result = await client.query(
        'SELECT * FROM mission.approvals WHERE tenant_id=$1 AND workspace_id=$2 AND id=$3',
        [ctx.tenantId, ctx.workspaceId, approvalId],
      );
      return result.rows[0] ? restore(result.rows[0]) : null;
    });
  }

  async save(ctx: TenantContext, approval: Approval): Promise<void> {
    if (!ctx.workspaceId || approval.workspaceBindingState !== 'WORKSPACE_BOUND' || approval.workspaceId !== ctx.workspaceId || approval.tenantId !== ctx.tenantId) {
      throw new Error('Approval workspace ownership mismatch');
    }
    const payload = JSON.stringify(snapshot(approval));
    await this.db.withTenant(ctx, async (client) => {
      if (approval.loadedVersion === undefined) {
        const result = await client.query(
          'INSERT INTO mission.approvals(tenant_id,workspace_id,workspace_binding_state,mission_id,id,payload,version) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING RETURNING id',
          [ctx.tenantId, ctx.workspaceId, approval.workspaceBindingState, approval.missionId, approval.id, payload, approval.version],
        );
        if (!result.rowCount) throw new ConcurrencyConflictError('Approval already exists', String(ctx.tenantId), String(approval.id), undefined);
      } else {
        const result = await client.query(
          'UPDATE mission.approvals SET payload=$4,version=$5,updated_at=NOW() WHERE tenant_id=$1 AND workspace_id=$2 AND id=$3 AND version=$6',
          [ctx.tenantId, ctx.workspaceId, approval.id, payload, approval.version, approval.loadedVersion],
        );
        if (!result.rowCount) throw new ConcurrencyConflictError('Stale approval or wrong workspace', String(ctx.tenantId), String(approval.id), approval.loadedVersion);
      }
    });
    approval.setVersion(approval.version);
  }
}
