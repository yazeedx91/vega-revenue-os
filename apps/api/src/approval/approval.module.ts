import { Module } from '@nestjs/common';
import { ApprovalApplicationService, InMemoryApprovalRepository, InMemoryNotificationAdapter } from '@projectx/mission-orchestrator';
import type { IWorkflowClient, WorkflowExecutionRef, WorkflowStartOptions, WorkflowStartResult } from '@projectx/infrastructure';
import type { TenantContext } from '@projectx/domain';
import { TemporalWorkflowClient } from '@projectx/temporal-client';
import type { CorrelationId, EventId, TenantId } from '@projectx/shared';
import { randomUUID } from 'crypto';
import { ApprovalController } from './approval.controller';

export const APPROVAL_SERVICE = 'APPROVAL_SERVICE';

class NoOpWorkflowClient implements IWorkflowClient {
  async start<TInput>(
    _ctx: TenantContext,
    _workflowType: string,
    _input: TInput,
    _options?: WorkflowStartOptions,
  ): Promise<WorkflowStartResult> {
    return {
      workflowId: 'noop',
      status: 'STARTED',
      tenantId: 'noop' as TenantId,
      correlationId: 'noop' as CorrelationId,
    };
  }
  async signal<TSignal>(
    _ctx: TenantContext,
    _ref: WorkflowExecutionRef,
    _signalName: string,
    _payload: TSignal,
  ): Promise<void> {}
  async query<TResult>(_ctx: TenantContext, _ref: WorkflowExecutionRef, _queryName: string): Promise<TResult> {
    return undefined as TResult;
  }
  async cancel(_ctx: TenantContext, _ref: WorkflowExecutionRef): Promise<void> {}
}

/**
 * Phase 14 Milestone 7a: HTTP surface for human approval decisions.
 *
 * The repository and notification port are in-memory in this milestone. The
 * workflow client is a real `@temporalio/client` adapter when `TEMPORAL_ADDRESS`
 * is configured; otherwise it uses a no-op stub so the controller can be
 * exercised in unit tests without a live Temporal server.
 */
@Module({
  controllers: [ApprovalController],
  providers: [
    {
      provide: 'WORKFLOW_CLIENT',
      useFactory: (): IWorkflowClient => {
        if (process.env.TEMPORAL_ADDRESS) {
          return new TemporalWorkflowClient({
            address: process.env.TEMPORAL_ADDRESS,
            namespace: process.env.TEMPORAL_NAMESPACE ?? 'default',
          });
        }
        return new NoOpWorkflowClient();
      },
    },
    {
      provide: APPROVAL_SERVICE,
      useFactory: (workflowClient: IWorkflowClient): ApprovalApplicationService => {
        return new ApprovalApplicationService({
          approvalRepository: new InMemoryApprovalRepository(),
          notificationPort: new InMemoryNotificationAdapter(),
          workflowClient,
          generateApprovalId: () => randomUUID(),
          generateEventId: () => randomUUID() as EventId,
          generateCorrelationId: () => randomUUID() as CorrelationId,
        });
      },
      inject: ['WORKFLOW_CLIENT'],
    },
  ],
})
export class ApprovalModule {}
