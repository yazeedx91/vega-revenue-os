import type { TenantContext } from '@projectx/domain';
import { WorkflowNotFoundError } from '@temporalio/client';
import type { IAuditLog, WorkflowExecutionRef } from '@projectx/infrastructure';
import type { CorrelationId, TenantId } from '@projectx/shared';
import type { ITemporalSignalDispatcher, TemporalSignalDispatchRequest, TemporalSignalDispatchResult } from '@projectx/outreach';
import { TemporalWorkflowClient } from './temporal-workflow-client';
import type { TemporalWorkflowClientConfig } from './temporal-workflow-client';

export interface TemporalSignalDispatcherConfig extends TemporalWorkflowClientConfig {
  readonly client?: TemporalWorkflowClient;
  readonly auditLog?: IAuditLog;
}

/**
 * Real `ITemporalSignalDispatcher` implementation backed by
 * `@temporalio/client`. Reuses `TemporalWorkflowClient` so signal dispatch
 * shares connection management with workflow-start operations.
 */
export class TemporalSignalDispatcher implements ITemporalSignalDispatcher {
  private readonly client: TemporalWorkflowClient;
  private readonly auditLog?: IAuditLog;

  constructor(config?: TemporalSignalDispatcherConfig) {
    this.client = config?.client ?? new TemporalWorkflowClient(config);
    this.auditLog = config?.auditLog;
  }

  async dispatch(request: TemporalSignalDispatchRequest): Promise<TemporalSignalDispatchResult> {
    try {
      const ctx: TenantContext = {
        tenantId: request.tenantId as TenantId,
        correlationId: request.correlationId,
      };
      const ref: WorkflowExecutionRef = {
        workflowId: request.workflowId,
        tenantId: ctx.tenantId,
        correlationId: request.correlationId as CorrelationId,
      };
      await this.client.signal(ctx, ref, request.signalName, request.payload);
      return { outcome: 'DISPATCHED' };
    } catch (err) {
      if (err instanceof WorkflowNotFoundError) {
        const reason = err.message;
        await this.auditWorkflowNotFound(request, reason);
        return { outcome: 'WORKFLOW_NOT_FOUND', reason };
      }
      const reason = err instanceof Error ? err.message : 'Unknown Temporal signal dispatch failure';
      return { outcome: 'FAILED', reason };
    }
  }

  private async auditWorkflowNotFound(request: TemporalSignalDispatchRequest, reason: string): Promise<void> {
    if (!this.auditLog) {
      return;
    }
    const ctx: TenantContext = {
      tenantId: request.tenantId as TenantId,
      correlationId: request.correlationId as CorrelationId,
    };
    await this.auditLog.record(ctx, {
      action: 'temporal_signal_workflow_not_found',
      resourceType: 'workflow',
      resourceId: request.workflowId,
      result: 'failure',
      reason,
      metadata: {
        signalName: request.signalName,
      },
    });
  }
}
