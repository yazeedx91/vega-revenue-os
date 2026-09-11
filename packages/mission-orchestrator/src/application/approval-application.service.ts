import type { TenantContext } from '@projectx/domain';
import { AuthorizationError, ensureSameTenant } from '@projectx/domain';
import type { CorrelationId, EventId, IdempotencyKey, UserId } from '@projectx/shared';
import { WorkflowIdFactory } from '@projectx/shared';
import type { ApprovalId } from '@projectx/domain';
import type { IWorkflowClient } from '@projectx/infrastructure';
import { Approval, type ApprovalProps } from '../domain/approval/approval';
import type { IApprovalRepository } from '../ports/approval-repository.interface';
import type { IMissionRepository } from '../ports/mission-repository.interface';
import type { INotificationPort } from '../ports/notification-port.interface';
import type { SubmitApprovalDecisionCommand, TimeoutApprovalCommand } from './contracts';

export interface RequestApprovalInput {
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
  idempotencyKey: IdempotencyKey;
}

export interface ApprovalApplicationDependencies {
  approvalRepository: IApprovalRepository;
  missionRepository: IMissionRepository;
  workflowClient: IWorkflowClient;
  notificationPort: INotificationPort;
  generateEventId: () => EventId;
  generateCorrelationId: () => CorrelationId;
  generateApprovalId: () => string;
}

export class ApprovalApplicationService {
  constructor(private readonly deps: ApprovalApplicationDependencies) {}

  async requestApproval(ctx: TenantContext, input: RequestApprovalInput): Promise<string> {
    if (!ctx.workspaceId) throw new AuthorizationError('Workspace access denied');
    const mission = await this.deps.missionRepository.findById(ctx, input.missionId);
    if (!mission || mission.workspaceBindingState !== 'WORKSPACE_BOUND' || mission.workspaceId !== ctx.workspaceId) {
      throw new AuthorizationError('Mission access denied');
    }
    const approvalId = this.deps.generateApprovalId();
    const props: ApprovalProps = {
      id: approvalId as unknown as ApprovalId,
      tenantId: mission.tenantId,
      workspaceId: mission.workspaceId,
      workspaceBindingState: 'WORKSPACE_BOUND',
      missionId: mission.id,
      sequenceId: input.sequenceId,
      taskId: input.taskId,
      executionId: input.executionId,
      actionType: input.actionType,
      riskCategory: input.riskCategory,
      proposedAction: input.proposedAction,
      evidence: input.evidence,
      reasoning: input.reasoning,
      confidence: input.confidence,
      requestedBy: input.requestedBy,
      approverRole: input.approverRole,
      timeoutSeconds: input.timeoutSeconds,
      idempotencyKey: input.idempotencyKey,
      correlationId: ctx.correlationId as CorrelationId,
    };

    const approvalResult = Approval.create(props, this.deps.generateEventId());
    if (!approvalResult.success) {
      throw new Error(`Cannot create approval: ${approvalResult.error.message}`);
    }
    const approval = approvalResult.value;
    await this.deps.approvalRepository.save(ctx, approval);
    await this.deps.notificationPort.notifyApprovalRequested(ctx, approval);
    return approvalId;
  }

  async approve(ctx: TenantContext, cmd: SubmitApprovalDecisionCommand): Promise<void> {
    await this.decide(ctx, cmd, 'APPROVED');
  }

  async reject(ctx: TenantContext, cmd: SubmitApprovalDecisionCommand): Promise<void> {
    await this.decide(ctx, cmd, 'REJECTED');
  }

  async timeout(ctx: TenantContext, cmd: TimeoutApprovalCommand): Promise<void> {
    const approval = await this.loadApproval(ctx, cmd.approvalId);
    const eventId = this.deps.generateEventId();
    const result = approval.expire(ctx.correlationId as CorrelationId, eventId);
    if (!result.success) {
      throw new Error(`Cannot expire approval: ${result.error.message}`);
    }
    await this.deps.approvalRepository.save(ctx, approval);
    await this.signalWorkflow(ctx, approval, 'EXPIRED', 'Approval timeout exceeded');
  }

  private async decide(
    ctx: TenantContext,
    cmd: SubmitApprovalDecisionCommand,
    status: 'APPROVED' | 'REJECTED',
  ): Promise<void> {
    const approval = await this.loadApproval(ctx, cmd.approvalId);
    const eventId = this.deps.generateEventId();
    const decidedBy = cmd.actorId as UserId;
    const result =
      status === 'APPROVED'
        ? approval.approve(decidedBy, cmd.reason, ctx.correlationId as CorrelationId, eventId)
        : approval.reject(decidedBy, cmd.reason, ctx.correlationId as CorrelationId, eventId);
    if (!result.success) {
      throw new Error(`Cannot ${status.toLowerCase()} approval: ${result.error.message}`);
    }
    await this.deps.approvalRepository.save(ctx, approval);
    await this.signalWorkflow(ctx, approval, status, cmd.reason);
  }

  private async loadApproval(ctx: TenantContext, approvalId: string): Promise<Approval> {
    if (!ctx.workspaceId) throw new AuthorizationError('Workspace access denied');
    const approval = await this.deps.approvalRepository.load(ctx, approvalId);
    if (!approval || approval.workspaceBindingState !== 'WORKSPACE_BOUND' || approval.workspaceId !== ctx.workspaceId) {
      throw new AuthorizationError('Approval access denied');
    }
    ensureSameTenant(ctx, approval.tenantId);
    return approval;
  }

  private async signalWorkflow(
    ctx: TenantContext,
    approval: Approval,
    decision: 'APPROVED' | 'REJECTED' | 'EXPIRED',
    reason: string,
  ): Promise<void> {
    const workflowId = approval.sequenceId
      ? WorkflowIdFactory.forOutreachSequence(approval.tenantId as string, approval.sequenceId)
      : WorkflowIdFactory.forMission(approval.tenantId as string, approval.missionId);

    const signalName = approval.sequenceId ? 'outreachApprovalGranted' : 'approvalDecision';
    const ref = {
      workflowId,
      tenantId: approval.tenantId,
      correlationId: ctx.correlationId as CorrelationId,
    };

    const payload = approval.sequenceId
      ? { executionId: approval.executionId, approvalId: approval.id }
      : { approvalId: approval.id, decision, reason };

    await this.deps.workflowClient.signal(ctx, ref, signalName, payload);
  }
}
