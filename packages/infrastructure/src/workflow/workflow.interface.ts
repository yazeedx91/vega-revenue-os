import type { TenantContext } from '@projectx/domain';
import type { CorrelationId, IdempotencyKey } from '@projectx/shared';

/**
 * Infrastructure-agnostic workflow engine contract.
 * Phase 07 defines interfaces only; provider-specific implementation comes later.
 */
export interface IWorkflowEngine {
  register<TInput, TResult>(
    workflowType: string,
    implementation: (ctx: TenantContext, input: TInput) => Promise<TResult>,
  ): void;
  start<TInput = unknown>(
    ctx: TenantContext,
    workflowType: string,
    input: TInput,
    options?: WorkflowStartOptions,
  ): Promise<WorkflowExecutionRef>;
  signal<TSignal = unknown>(
    ctx: TenantContext,
    ref: WorkflowExecutionRef,
    signalName: string,
    payload: TSignal,
  ): Promise<void>;
  query<TResult = unknown>(
    ctx: TenantContext,
    ref: WorkflowExecutionRef,
    queryName: string,
  ): Promise<TResult>;
  cancel(ctx: TenantContext, ref: WorkflowExecutionRef): Promise<void>;
}

/**
 * Client-side boundary for long-running workflow orchestration.
 */
export interface IWorkflowClient {
  start<TInput = unknown>(
    ctx: TenantContext,
    workflowType: string,
    input: TInput,
    options?: WorkflowStartOptions,
  ): Promise<WorkflowStartResult>;
  signal<TSignal = unknown>(
    ctx: TenantContext,
    ref: WorkflowExecutionRef,
    signalName: string,
    payload: TSignal,
  ): Promise<void>;
  query<TResult = unknown>(
    ctx: TenantContext,
    ref: WorkflowExecutionRef,
    queryName: string,
  ): Promise<TResult>;
  cancel(ctx: TenantContext, ref: WorkflowExecutionRef): Promise<void>;
}

export interface WorkflowExecutionRef {
  workflowId: string;
  runId?: string;
  tenantId: string;
  correlationId: CorrelationId;
}

export interface WorkflowStartResult extends WorkflowExecutionRef {
  status: 'STARTED' | 'ALREADY_RUNNING';
}

export interface WorkflowStartOptions {
  idempotencyKey?: IdempotencyKey;
  taskQueue?: string;
  timeoutSeconds?: number;
  workflowId?: string;
}
