import type { CorrelationId, IdempotencyKey } from '../types/correlation';
import type { TenantId } from '../types/tenant-id';

export interface ToolCallRequest<TInput = unknown> {
  toolCallId: string;
  toolId: string;
  toolVersion: string;
  tenantId: TenantId;
  missionId?: string;
  agentId?: string;
  agentVersion?: string;
  executionId?: string;
  taskId?: string;
  correlationId: CorrelationId;
  idempotencyKey?: IdempotencyKey;
  authorization: ToolAuthorization;
  riskCategory: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  input: TInput;
  timeoutSeconds: number;
  metadata?: Record<string, unknown>;
}

export interface ToolAuthorization {
  policyDecisionId: string;
  decision: 'ALLOW' | 'REQUIRE_APPROVAL' | 'DENY';
  capabilities: string[];
  expiresAt: Date;
}

export interface ToolCallResult<TOutput = unknown> {
  toolCallId: string;
  status: 'SUCCESS' | 'VALIDATION_ERROR' | 'PROVIDER_ERROR' | 'TIMEOUT' | 'UNAUTHORIZED' | 'POLICY_DENIED' | 'FAILED';
  output?: TOutput;
  error?: {
    code: string;
    message: string;
    retryable: boolean;
  };
  validation: ToolValidation;
  provider: string;
  startedAt: Date;
  completedAt: Date;
  retryCount: number;
  auditId: string;
}

export interface ToolValidation {
  schemaValid: boolean;
  tenantIsolationCheck: boolean;
  piiCheck: 'PASSED' | 'FAILED' | 'NOT_RUN';
}
