import { Client, Connection, WorkflowExecutionAlreadyStartedError, WorkflowNotFoundError } from '@temporalio/client';
import type { TenantContext } from '@projectx/domain';
import type {
  IWorkflowClient,
  WorkflowExecutionRef,
  WorkflowStartOptions,
  WorkflowStartResult,
} from '@projectx/infrastructure';
import type { CorrelationId } from '@projectx/shared';

export interface TemporalWorkflowClientConfig {
  readonly address?: string;
  readonly namespace?: string;
}

/**
 * Real `IWorkflowClient` implementation backed by `@temporalio/client`.
 *
 * Workflow-start deduplication is authoritative and race-free: the caller must
 * always supply a deterministic `workflowId` (from `WorkflowIdFactory`,
 * ADR-126) and `TemporalWorkflowClient` always sets
 * `workflowIdReusePolicy: 'REJECT_DUPLICATE'`. An attempt to start an already
 * running workflow is translated into an idempotent `ALREADY_RUNNING` result
 * instead of an exception, so callers never need a check-then-start dance.
 */
export class TemporalWorkflowClient implements IWorkflowClient {
  private clientPromise: Promise<Client> | undefined;

  constructor(private readonly config: TemporalWorkflowClientConfig = {}) {}

  private async getClient(): Promise<Client> {
    if (!this.clientPromise) {
      this.clientPromise = Connection.connect({ address: this.config.address }).then(
        (connection) => new Client({ connection, namespace: this.config.namespace }),
      );
    }
    return this.clientPromise;
  }

  async start<TInput = unknown>(
    ctx: TenantContext,
    workflowType: string,
    input: TInput,
    options?: WorkflowStartOptions,
  ): Promise<WorkflowStartResult> {
    const client = await this.getClient();
    const workflowId = options?.workflowId;
    if (!workflowId) {
      throw new Error('Deterministic workflowId is required; use WorkflowIdFactory.');
    }

    try {
      const handle = await client.workflow.start(workflowType, {
        taskQueue: options?.taskQueue ?? 'default',
        workflowId,
        args: [input],
        workflowIdReusePolicy: 'REJECT_DUPLICATE',
      });

      return {
        workflowId,
        runId: handle.firstExecutionRunId,
        tenantId: ctx.tenantId as string,
        correlationId: ctx.correlationId as CorrelationId,
        status: 'STARTED',
      };
    } catch (err) {
      if (err instanceof WorkflowExecutionAlreadyStartedError) {
        return {
          workflowId,
          tenantId: ctx.tenantId as string,
          correlationId: ctx.correlationId as CorrelationId,
          status: 'ALREADY_RUNNING',
        };
      }
      throw err;
    }
  }

  async signal<TSignal = unknown>(
    ctx: TenantContext,
    ref: WorkflowExecutionRef,
    signalName: string,
    payload: TSignal,
  ): Promise<void> {
    const client = await this.getClient();
    const handle = client.workflow.getHandle(ref.workflowId, ref.runId);
    await handle.signal(signalName, payload);
  }

  async query<TResult = unknown>(ctx: TenantContext, ref: WorkflowExecutionRef, queryName: string): Promise<TResult> {
    const client = await this.getClient();
    const handle = client.workflow.getHandle(ref.workflowId, ref.runId);
    return (await handle.query(queryName)) as TResult;
  }

  async cancel(_ctx: TenantContext, ref: WorkflowExecutionRef): Promise<void> {
    const client = await this.getClient();
    const handle = client.workflow.getHandle(ref.workflowId, ref.runId);
    await handle.cancel();
  }

  async close(): Promise<void> {
    if (!this.clientPromise) return;
    const client = await this.clientPromise;
    await client.connection.close();
    this.clientPromise = undefined;
  }
}

export { WorkflowNotFoundError };
