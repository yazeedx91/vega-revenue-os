import type { CorrelationId, IdempotencyKey } from '../types/correlation';
import type { TenantId } from '../types/tenant-id';

/**
 * Contract between the Mission Orchestrator / Temporal workflows and the AI Execution Plane.
 * Aligned with docs/technology/15-ai-execution-contract.md.
 */
export interface AIExecutionRequest {
  executionId: string;
  tenantId: TenantId;
  missionId: string;
  agentId: string;
  agentVersion: string;
  taskId: string;
  taskType: string;
  correlationId: CorrelationId;
  context: ExecutionContext;
  capabilities: string[];
  policyContext: ExecutionPolicyContext;
  budget: ExecutionBudget;
  deadline?: Date;
  idempotencyKey: IdempotencyKey;
  metadata?: Record<string, unknown>;
}

export interface ExecutionContext {
  mission?: Record<string, unknown>;
  plan?: Record<string, unknown>;
  target?: Record<string, unknown>;
  constraints?: unknown[];
}

export interface ExecutionPolicyContext {
  autonomyLevel: number;
  riskCategory: string;
  tenantPolicyVersion: string;
  missionPolicyVersion: string;
}

export interface ExecutionBudget {
  maxTokens: number;
  maxCostUsd: number;
  maxDurationSeconds: number;
}

export interface AIExecutionResult {
  executionId: string;
  tenantId: TenantId;
  missionId: string;
  status: AIExecutionStatus;
  outcome: ExecutionOutcome;
  modelUsage: ModelUsage;
  startedAt: Date;
  completedAt: Date;
  correlationId: CorrelationId;
  events: string[];
}

export type AIExecutionStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'AWAITING_APPROVAL'
  | 'PAUSED'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED'
  | 'TIMED_OUT';

export interface ExecutionOutcome {
  summary: string;
  decisions: unknown[];
  actions: unknown[];
  evidence: unknown[];
}

export interface ModelUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}
