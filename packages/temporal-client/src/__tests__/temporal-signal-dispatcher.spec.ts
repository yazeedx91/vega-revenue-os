import type { TenantContext } from '@projectx/domain';
import { InMemoryAuditLog } from '@projectx/infrastructure';
import type { IWorkflowClient, WorkflowExecutionRef, WorkflowStartResult } from '@projectx/infrastructure';
import type { CorrelationId, TenantId } from '@projectx/shared';
import { TemporalSignalDispatcher } from '../temporal-signal-dispatcher';
import { WorkflowNotFoundError } from '@temporalio/client';

describe('TemporalSignalDispatcher', () => {
  class FakeTemporalWorkflowClient implements IWorkflowClient {
    signals: Array<{
      ctx: TenantContext;
      ref: WorkflowExecutionRef;
      signalName: string;
      payload: unknown;
    }> = [];
    shouldThrowWorkflowNotFound = false;

    async start<TInput>(ctx: TenantContext, workflowType: string, input: TInput): Promise<WorkflowStartResult> {
      return {
        workflowId: 'wf-1',
        status: 'STARTED',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
      };
    }

    async signal<TSignal>(ctx: TenantContext, ref: WorkflowExecutionRef, signalName: string, payload: TSignal): Promise<void> {
      if (this.shouldThrowWorkflowNotFound) {
        throw new WorkflowNotFoundError('Workflow not found');
      }
      this.signals.push({ ctx, ref, signalName, payload });
    }

    async query<TResult>(ctx: TenantContext, ref: WorkflowExecutionRef, queryName: string): Promise<TResult> {
      return undefined as TResult;
    }

    async cancel(ctx: TenantContext, ref: WorkflowExecutionRef): Promise<void> {}
  }

  it('dispatches replyReceived to the correct workflow with tenant context and payload', async () => {
    const client = new FakeTemporalWorkflowClient();
    const auditLog = new InMemoryAuditLog();
    const dispatcher = new TemporalSignalDispatcher({ address: 'localhost:7233', client, auditLog });

    const result = await dispatcher.dispatch({
      workflowId: 'outreach-sequence-v1-tenant-a-seq-1',
      signalName: 'replyReceived',
      payload: {
        providerMessageId: 'graph-msg-1',
        content: 'Sounds great',
        channel: 'email',
        responseType: 'REPLIED',
        autonomyLevel: 2,
      },
      tenantId: 'tenant-a',
      correlationId: 'corr-1',
    });

    expect(result.outcome).toBe('DISPATCHED');
    expect(client.signals).toHaveLength(1);

    const sent = client.signals[0];
    expect(sent.ctx.tenantId).toBe('tenant-a');
    expect(sent.ctx.correlationId).toBe('corr-1');
    expect(sent.ref.workflowId).toBe('outreach-sequence-v1-tenant-a-seq-1');
    expect(sent.ref.tenantId).toBe('tenant-a');
    expect(sent.ref.correlationId).toBe('corr-1');
    expect(sent.signalName).toBe('replyReceived');
    expect(sent.payload).toMatchObject({ providerMessageId: 'graph-msg-1' });
  });

  it('returns WORKFLOW_NOT_FOUND and records an audit entry without creating a workflow', async () => {
    const client = new FakeTemporalWorkflowClient();
    client.shouldThrowWorkflowNotFound = true;
    const auditLog = new InMemoryAuditLog();
    const dispatcher = new TemporalSignalDispatcher({ address: 'localhost:7233', client, auditLog });

    const result = await dispatcher.dispatch({
      workflowId: 'outreach-sequence-v1-tenant-a-seq-1',
      signalName: 'replyReceived',
      payload: { providerMessageId: 'graph-msg-2' },
      tenantId: 'tenant-a',
      correlationId: 'corr-2',
    });

    expect(result.outcome).toBe('WORKFLOW_NOT_FOUND');
    expect(client.signals).toHaveLength(0);
    const auditEntry = auditLog.entries.find((e) => e.action === 'temporal_signal_workflow_not_found');
    expect(auditEntry).toBeDefined();
    expect(auditEntry!.tenantId).toBe('tenant-a');
    expect(auditEntry!.correlationId).toBe('corr-2');
    expect(auditEntry!.resourceId).toBe('outreach-sequence-v1-tenant-a-seq-1');
    expect(auditEntry!.result).toBe('failure');
  });

  it('does not implicitly start a workflow when signal target is missing', async () => {
    const client = new FakeTemporalWorkflowClient();
    client.shouldThrowWorkflowNotFound = true;
    const dispatcher = new TemporalSignalDispatcher({ address: 'localhost:7233', client });

    const result = await dispatcher.dispatch({
      workflowId: 'missing-workflow',
      signalName: 'replyReceived',
      payload: {},
      tenantId: 'tenant-a',
      correlationId: 'corr-3',
    });

    expect(result.outcome).toBe('WORKFLOW_NOT_FOUND');
    expect(client.signals).toHaveLength(0);
  });
});
