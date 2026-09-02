import type { ExecutionBudget, TenantId } from '@projectx/shared';
import type { AIExecutionStatus, ToolCallResult } from '@projectx/shared';

export type FailureClassification =
  | 'TRANSIENT_PROVIDER_ERROR'
  | 'TIMEOUT'
  | 'POLICY_DENIED'
  | 'VALIDATION_ERROR'
  | 'TOOL_FAILURE'
  | 'MALFORMED_OUTPUT'
  | 'BUDGET_EXHAUSTED'
  | 'AUTHORIZATION_FAILURE'
  | 'TENANT_CONTEXT_FAILURE'
  | 'NON_RETRYABLE_BUSINESS_FAILURE';

export interface ExecutionFailure {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
  readonly classification: FailureClassification;
}

export interface Checkpoint {
  readonly step: number;
  readonly status: AIExecutionStatus;
  readonly recordedAt: Date;
  readonly metadata?: Record<string, unknown>;
}

export interface ExecutionStateSnapshot {
  readonly executionId: string;
  readonly tenantId: TenantId;
  readonly missionId: string;
  readonly taskId: string;
  readonly agentId: string;
  readonly status: AIExecutionStatus;
  readonly currentStep: number;
  readonly checkpoints: Checkpoint[];
  readonly budgetConsumed: ExecutionBudget;
  readonly toolExecutionHistory: ToolCallResult[];
  readonly failure?: ExecutionFailure;
}

export class ExecutionState {
  private _status: AIExecutionStatus = 'PENDING';
  private _currentStep = 0;
  private readonly _checkpoints: Checkpoint[] = [];
  private readonly _toolHistory: ToolCallResult[] = [];
  private _budgetConsumed: ExecutionBudget;
  private _failure?: ExecutionFailure;

  constructor(
    public readonly executionId: string,
    public readonly tenantId: TenantId,
    public readonly missionId: string,
    public readonly taskId: string,
    public readonly agentId: string,
    budget: ExecutionBudget,
  ) {
    this._budgetConsumed = { ...budget, maxTokens: 0, maxCostUsd: 0, maxDurationSeconds: 0 };
  }

  get status(): AIExecutionStatus {
    return this._status;
  }

  get currentStep(): number {
    return this._currentStep;
  }

  get checkpoints(): readonly Checkpoint[] {
    return this._checkpoints;
  }

  get toolExecutionHistory(): readonly ToolCallResult[] {
    return this._toolHistory;
  }

  get budgetConsumed(): ExecutionBudget {
    return this._budgetConsumed;
  }

  get failure(): ExecutionFailure | undefined {
    return this._failure;
  }

  transition(status: AIExecutionStatus): void {
    this._status = status;
    this.checkpoint(status);
  }

  checkpoint(status: AIExecutionStatus, metadata?: Record<string, unknown>): void {
    this._checkpoints.push({ step: this._currentStep, status, recordedAt: new Date(), metadata });
  }

  nextStep(): void {
    this._currentStep += 1;
  }

  recordToolResult(result: ToolCallResult): void {
    this._toolHistory.push(result);
  }

  consumeBudget(tokens: number, costUsd: number, durationSeconds: number): void {
    this._budgetConsumed = {
      ...this._budgetConsumed,
      maxTokens: this._budgetConsumed.maxTokens + tokens,
      maxCostUsd: this._budgetConsumed.maxCostUsd + costUsd,
      maxDurationSeconds: this._budgetConsumed.maxDurationSeconds + durationSeconds,
    };
  }

  isWithinBudget(budget: ExecutionBudget): boolean {
    return (
      this._budgetConsumed.maxTokens <= budget.maxTokens &&
      this._budgetConsumed.maxCostUsd <= budget.maxCostUsd &&
      this._budgetConsumed.maxDurationSeconds <= budget.maxDurationSeconds
    );
  }

  markFailure(failure: ExecutionFailure): void {
    this._failure = failure;
    this._status = 'FAILED';
    this.checkpoint('FAILED', { failure });
  }

  snapshot(): ExecutionStateSnapshot {
    return {
      executionId: this.executionId,
      tenantId: this.tenantId,
      missionId: this.missionId,
      taskId: this.taskId,
      agentId: this.agentId,
      status: this._status,
      currentStep: this._currentStep,
      checkpoints: this._checkpoints.slice(),
      budgetConsumed: this._budgetConsumed,
      toolExecutionHistory: this._toolHistory.slice(),
      failure: this._failure,
    };
  }
}
