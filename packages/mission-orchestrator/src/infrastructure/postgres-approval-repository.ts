import type { Pool } from 'pg';
import { Approval } from '../domain/approval/approval';
import type { IApprovalRepository } from '../ports/approval-repository.interface';
import type { ApprovalStatus } from '../domain/approval/approval-status';
import type { TenantId, ApprovalId, CorrelationId, IdempotencyKey, UserId } from '@projectx/shared';
import { PostgresRepository, toDate } from '@projectx/infrastructure';

export interface PostgresApprovalRepositoryConfig {
  pool: Pool;
}

type ApprovalSnapshot = {
  id?: ApprovalId;
  tenantId?: TenantId;
  missionId: string;
  sequenceId?: string;
  taskId?: string;
  executionId?: string;
  actionType: string;
  riskCategory: string;
  proposedAction: unknown;
  evidence: unknown[];
  reasoning: string;
  confidence: number;
  requestedBy: string;
  approverRole: string;
  timeoutSeconds: number;
  idempotencyKey: string;
  correlationId: string;
  status: string;
  decidedBy?: string;
  decisionReason?: string;
  createdAt: Date;
  updatedAt: Date;
};

export class PostgresApprovalRepository implements IApprovalRepository {
  private readonly repository: PostgresRepository<Approval, ApprovalSnapshot, ApprovalId>;

  constructor(config: PostgresApprovalRepositoryConfig) {
    this.repository = new PostgresRepository<Approval, ApprovalSnapshot, ApprovalId>(
      { pool: config.pool, tableName: 'mission.approvals' },
      {
        toSnapshot: (entity) => ({
          id: entity.id,
          tenantId: entity.tenantId,
          missionId: entity.missionId,
          sequenceId: entity.sequenceId,
          taskId: entity.taskId,
          executionId: entity.executionId,
          actionType: entity.actionType,
          riskCategory: entity.riskCategory,
          proposedAction: entity.proposedAction,
          evidence: entity.evidence,
          reasoning: entity.reasoning,
          confidence: entity.confidence,
          requestedBy: entity.requestedBy,
          approverRole: entity.approverRole,
          timeoutSeconds: entity.timeoutSeconds,
          idempotencyKey: entity.idempotencyKey as string,
          correlationId: entity.correlationId as string,
          status: entity.status,
          decidedBy: entity.decidedBy,
          decisionReason: entity.decisionReason,
          createdAt: entity.createdAt,
          updatedAt: entity.updatedAt,
        }),
        fromSnapshot: (snapshot, id, tenantId, version) =>
          Approval.reconstitute(
            {
              ...snapshot,
              id,
              tenantId: tenantId as TenantId,
              status: snapshot.status as ApprovalStatus,
              idempotencyKey: snapshot.idempotencyKey as IdempotencyKey,
              correlationId: snapshot.correlationId as CorrelationId,
              decidedBy: snapshot.decidedBy as UserId | undefined,
              createdAt: toDate(snapshot.createdAt),
              updatedAt: toDate(snapshot.updatedAt),
            },
            version,
          ),
      },
    );
  }

  async load(tenantId: TenantId, approvalId: string): Promise<Approval | null> {
    return this.repository.findById(
      { tenantId, correlationId: '' as string },
      approvalId as ApprovalId,
    );
  }

  async save(approval: Approval): Promise<void> {
    await this.repository.save(
      { tenantId: approval.tenantId, correlationId: '' as string },
      approval,
    );
  }
}
