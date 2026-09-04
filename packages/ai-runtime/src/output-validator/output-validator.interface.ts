import type { TenantContext } from '@projectx/domain';
import type { AIExecutionRequest, CorrelationId, IdempotencyKey, ToolCallResult } from '@projectx/shared';

/**
 * Validates an agent's proposed output for policy, PII, and schema compliance.
 */
export interface IOutputValidator {
  validate(ctx: TenantContext, request: OutputValidationRequest): Promise<OutputValidationResult>;
}

export interface SchemaDefinition {
  readonly type: 'object' | 'array' | 'string' | 'number' | 'boolean';
  readonly required?: string[];
  readonly properties?: Record<string, SchemaDefinition>;
  readonly items?: SchemaDefinition;
  readonly allowedValues?: unknown[];
}

export interface OutputValidatorPolicy {
  readonly requiredFields: string[];
  readonly forbiddenValues: string[];
  readonly allowedActions: string[];
  readonly piiPatterns: RegExp[];
  readonly schema?: SchemaDefinition;
}

export interface OutputValidationRequest {
  execution: AIExecutionRequest;
  proposedOutput: unknown;
  toolResults?: ToolCallResult[];
  correlationId: CorrelationId;
  idempotencyKey?: IdempotencyKey;
  deadline?: Date;
  abortSignal?: AbortSignal;
  /** Optional override policy for this validation. */
  policy?: OutputValidatorPolicy;
}

export interface OutputValidationResult {
  valid: boolean;
  piiCheck: 'PASSED' | 'FAILED';
  schemaViolations?: string[];
  policyViolations?: string[];
  safeOutput: unknown;
}
