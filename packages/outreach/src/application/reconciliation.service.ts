import type { TenantContext } from '@projectx/domain';
import type { CorrelationId, EventId, OutreachExecutionId } from '@projectx/shared';
import type { IAuditLog, IIdempotencyStore } from '@projectx/infrastructure';
import type { IMessageExecutionRepository } from '../ports/outreach-repository.interface';

export type ReconciliationDecision = 'DELIVERED' | 'FAILED';

export interface ReconciliationServiceDependencies {
  executionRepository: IMessageExecutionRepository;
  idempotencyStore: IIdempotencyStore;
  auditLog: IAuditLog;
  generateEventId: () => string;
}

export class ReconciliationService {
  constructor(private readonly deps: ReconciliationServiceDependencies) {}

  async reconcile(
    ctx: TenantContext,
    executionId: OutreachExecutionId,
    decision: ReconciliationDecision,
    operatorId: string,
    reason: string,
    providerMessageId?: string,
  ): Promise<{ status: 'success' | 'failed'; reason?: string }> {
    const execution = await this.deps.executionRepository.load(ctx, executionId);
    if (!execution) {
      return { status: 'failed', reason: 'Execution not found' };
    }

    if (execution.status !== 'DELIVERY_UNKNOWN' && execution.status !== 'REQUIRES_RECONCILIATION') {
      return { status: 'failed', reason: `Execution is not in a reconcilable state (status: ${execution.status})` };
    }

    const eventId = this.deps.generateEventId() as EventId;

    if (decision === 'DELIVERED') {
      const result = execution.markReconciledDelivered(providerMessageId, ctx.correlationId as CorrelationId, eventId);
      if (!result.success) {
        await this.auditReconciliation(ctx, executionId as string, decision, operatorId, reason, 'failed', result.error.message);
        return { status: 'failed', reason: result.error.message };
      }

      await this.deps.executionRepository.save(ctx, execution);
      await this.deps.idempotencyStore.set(
        ctx,
        'outreach:send',
        execution.idempotencyKey,
        { submitted: true, providerMessageId },
        { status: 'COMPLETED' },
      );
      await this.auditReconciliation(ctx, executionId as string, decision, operatorId, reason, 'success');
      return { status: 'success' };
    }

    const result = execution.markReconciledFailed(reason, ctx.correlationId as CorrelationId, eventId);
    if (!result.success) {
      await this.auditReconciliation(ctx, executionId as string, decision, operatorId, reason, 'failed', result.error.message);
      return { status: 'failed', reason: result.error.message };
    }

    await this.deps.executionRepository.save(ctx, execution);
    await this.deps.idempotencyStore.set(
      ctx,
      'outreach:send',
      execution.idempotencyKey,
      { submitted: true, reason: `Operator reconciled as failed: ${reason}` },
      { status: 'FAILED' },
    );
    await this.auditReconciliation(ctx, executionId as string, decision, operatorId, reason, 'success');
    return { status: 'success' };
  }

  private async auditReconciliation(
    ctx: TenantContext,
    executionId: string,
    decision: string,
    operatorId: string,
    reason: string,
    result: 'success' | 'failed',
    failureReason?: string,
  ): Promise<void> {
    await this.deps.auditLog.record(ctx, {
      action: 'OUTREACH_RECONCILIATION_DECISION',
      resourceType: 'OutreachMessageExecution',
      resourceId: executionId,
      result: result === 'success' ? 'success' : 'failure',
      reason: failureReason ?? reason,
      metadata: {
        decision,
        operatorId,
        reason,
        ...(failureReason ? { failureReason } : {}),
      },
    });
  }
}
