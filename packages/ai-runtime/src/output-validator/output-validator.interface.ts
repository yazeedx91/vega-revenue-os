import type { TenantContext } from '@projectx/domain';
import type { AIExecutionRequest, CorrelationId, IdempotencyKey, ToolCallResult } from '@projectx/shared';

/**
 * Validates an agent's proposed output for policy, PII, and schema compliance.
 */
export interface IOutputValidator {
  validate(ctx: TenantContext, request: OutputValidationRequest): Promise<OutputValidationResult>;
}

export interface OutputValidationRequest {
  execution: AIExecutionRequest;
  proposedOutput: unknown;
  toolResults?: ToolCallResult[];
  correlationId: CorrelationId;
  idempotencyKey?: IdempotencyKey;
  deadline?: Date;
  abortSignal?: AbortSignal;
}

export interface OutputValidationResult {
  valid: boolean;
  piiCheck: 'PASSED' | 'FAILED';
  schemaViolations?: string[];
  policyViolations?: string[];
  safeOutput: unknown;
}
